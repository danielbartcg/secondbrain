import "server-only";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { requireMapAccess } from "@/lib/map-access";
import { projectAccessWhere } from "@/lib/projects";
import { rewindMap, rewindTask, risksAt, type TaskEventLite, type TaskState } from "@/lib/shared/time-travel";
import { levelLabel, riskLevel, riskScore } from "@/lib/shared/risks";
import type { RiskDto } from "@/lib/risks";

/**
 * Voyage dans le temps : état d'un projet ou d'une carte à une date passée,
 * reconstitué en rembobinant les pistes d'audit (règles pures :
 * `src/lib/shared/time-travel.ts`). Lecture seule, en ligne. Limites : les
 * tâches supprimées et leur historique ont disparu ; les étapes n'ont pas de
 * piste d'audit (nom actuel, existence d'après leur date de création).
 */

const FIELDS = ["name", "status", "progress", "priority", "complexity", "startDate", "dueDate", "assigneeId"];
const isDone = (s: string) => s === "DONE" || s === "CLOSED";
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export type TimeTask = TaskState & { id: string; stageId: string | null; changedSince: boolean };
export type TimeStage = { id: string; name: string; total: number; done: number; percent: number };
/** Risque ou opportunité tel qu'il était (instantanés `RiskSnapshot`). */
export type TimeRisk = RiskDto & { changedSince: boolean; deletedSince: boolean };

export type ProjectAt = {
  at: string;
  createdAt: string;
  stats: { total: number; done: number; inProgress: number; todo: number; percent: number; late: number };
  stages: TimeStage[];
  tasks: TimeTask[];
  /** Depuis cette date : tâches créées, tâches modifiées. */
  since: { created: number; changed: number };
  /** Courbe d'avancement (moyenne des tâches existantes), de la création du projet à aujourd'hui. */
  curve: { date: string; percent: number; done: number; total: number }[];
  /** Registre des risques et opportunités à cette date (tous statuts). */
  risks: TimeRisk[];
};

export async function getProjectAt(userId: string, projectId: string, at: Date): Promise<ProjectAt> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true, createdAt: true } });
  if (!project) throw notFound("Projet");
  const [tasks, stages] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      orderBy: [{ order: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        progress: true,
        priority: true,
        complexity: true,
        startDate: true,
        dueDate: true,
        stageId: true,
        createdAt: true,
        assignee: { select: { name: true } },
      },
    }),
    prisma.stage.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { id: true, name: true, createdAt: true } }),
  ]);
  const events = await prisma.taskEvent.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) }, field: { in: FIELDS } },
    orderBy: { createdAt: "asc" },
    select: { taskId: true, createdAt: true, kind: true, field: true, oldValue: true, newValue: true },
  });
  const byTask = new Map<string, TaskEventLite[]>();
  for (const e of events) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);

  const current = tasks.map((t) => ({
    t,
    state: {
      name: t.name,
      status: t.status,
      progress: t.progress,
      priority: t.priority,
      complexity: t.complexity,
      startDate: day(t.startDate),
      dueDate: day(t.dueDate),
      assignee: t.assignee?.name ?? null,
    } satisfies TaskState,
  }));

  const stateAt = (when: Date) =>
    current.filter(({ t }) => t.createdAt.getTime() <= when.getTime()).map(({ t, state }) => ({ t, s: rewindTask(state, byTask.get(t.id) ?? [], when) }));

  const now = new Date();
  const when = at.getTime() > now.getTime() ? now : at;
  const rows = stateAt(when);
  const atDay = day(when)!;
  const timeTasks: TimeTask[] = rows.map(({ t, s }) => ({
    ...s,
    id: t.id,
    stageId: t.stageId,
    changedSince: (byTask.get(t.id) ?? []).some((e) => e.createdAt.getTime() > when.getTime()),
  }));

  const stagesAt: TimeStage[] = stages
    .filter((s) => s.createdAt.getTime() <= when.getTime())
    .map((s) => {
      const ts = timeTasks.filter((t) => t.stageId === s.id);
      return { id: s.id, name: s.name, total: ts.length, done: ts.filter((t) => isDone(t.status)).length, percent: pct(ts.map((t) => t.progress)) };
    });

  // Courbe : 40 points au plus, de la création du projet à aujourd'hui.
  const start = project.createdAt.getTime();
  const span = Math.max(1, now.getTime() - start);
  const steps = Math.min(40, Math.max(2, Math.ceil(span / 86_400_000)));
  const curve = Array.from({ length: steps + 1 }, (_, i) => {
    const d = new Date(start + (span * i) / steps);
    const r = stateAt(d);
    return { date: d.toISOString(), percent: pct(r.map((x) => x.s.progress)), done: r.filter((x) => isDone(x.s.status)).length, total: r.length };
  });

  return {
    at: when.toISOString(),
    createdAt: project.createdAt.toISOString(),
    stats: {
      total: timeTasks.length,
      done: timeTasks.filter((t) => isDone(t.status)).length,
      inProgress: timeTasks.filter((t) => t.status === "IN_PROGRESS").length,
      todo: timeTasks.filter((t) => t.status === "TODO").length,
      percent: pct(timeTasks.map((t) => t.progress)),
      late: timeTasks.filter((t) => !isDone(t.status) && t.dueDate !== null && t.dueDate < atDay).length,
    },
    stages: stagesAt,
    tasks: timeTasks,
    since: { created: tasks.length - rows.length, changed: timeTasks.filter((t) => t.changedSince).length },
    curve,
    risks: await risksOfProjectAt(projectId, when),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ts = (v: unknown) => (typeof v === "string" ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`).toISOString() : new Date(0).toISOString());

/** Registre des risques à une date, d'après les instantanés (déclencheur `sb_risk_snapshot`). */
async function risksOfProjectAt(projectId: string, when: Date): Promise<TimeRisk[]> {
  const snaps = await prisma.riskSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { riskId: true, deleted: true, createdAt: true, data: true } });
  const states = risksAt(
    snaps.map((s) => ({ ...s, data: (s.data ?? {}) as Record<string, unknown> })),
    when,
  );
  const ownerIds = [...new Set(states.map((s) => str(s.data.ownerId)).filter(Boolean))];
  const owners = new Map((await prisma.projectMember.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  return states
    .map(({ riskId, data, changedSince, deletedSince }): TimeRisk => {
      const kind = data.kind === "OPPORTUNITY" ? "OPPORTUNITY" : "RISK";
      const probability = int(data.probability, 3);
      const impact = int(data.impact, 3);
      const score = riskScore(probability, impact);
      const level = riskLevel(score);
      const ownerId = str(data.ownerId) || null;
      return {
        id: riskId,
        projectId,
        kind,
        title: str(data.title) || "Sans titre",
        description: str(data.description),
        category: str(data.category),
        probability,
        impact,
        score,
        level,
        levelLabel: levelLabel(kind, level),
        status: (["OPEN", "MONITORING", "TREATED", "CLOSED"].includes(str(data.status)) ? str(data.status) : "OPEN") as RiskDto["status"],
        ownerId,
        ownerName: ownerId ? (owners.get(ownerId) ?? null) : null,
        response: str(data.response),
        strategy: (["ACCEPT", "MITIGATE", "TRANSFER", "ELIMINATE"].includes(str(data.strategy)) ? str(data.strategy) : null) as RiskDto["strategy"],
        order: int(data.order, 0),
        taskIds: [],
        tasks: [],
        createdAt: ts(data.createdAt),
        updatedAt: ts(data.updatedAt),
        changedSince,
        deletedSince,
      };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

export type MapAt = {
  at: string;
  createdAt: string;
  nodes: { id: string; parentId: string | null; title: string; status: string; color: string | null }[];
  deletedSince: { id: string; title: string; at: string }[];
  movedSince: { id: string; title: string; from: string | null }[];
  createdSince: number;
};

export async function getMapAt(userId: string, mapId: string, at: Date): Promise<MapAt> {
  await requireMapAccess(userId, mapId, "read");
  const [map, nodes, events] = await Promise.all([
    prisma.mindMap.findUniqueOrThrow({ where: { id: mapId }, select: { createdAt: true } }),
    prisma.mindNode.findMany({ where: { mapId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, parentId: true, title: true, status: true, color: true, createdAt: true } }),
    prisma.mapEvent.findMany({ where: { mapId, createdAt: { gt: at } }, select: { createdAt: true, kind: true, nodeId: true, nodeTitle: true, oldValue: true, newValue: true } }),
  ]);
  const r = rewindMap(nodes, events, at);
  return {
    at: at.toISOString(),
    createdAt: map.createdAt.toISOString(),
    nodes: r.nodes.map(({ id, parentId, title, status, color }) => ({ id, parentId, title, status, color })),
    deletedSince: r.deletedSince,
    movedSince: r.movedSince,
    createdSince: nodes.length - r.nodes.length,
  };
}
