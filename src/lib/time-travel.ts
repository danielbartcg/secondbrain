import "server-only";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { requireMapAccess } from "@/lib/map-access";
import { projectAccessWhere } from "@/lib/projects";
import { rewindMap, rewindTask, type TaskEventLite, type TaskState } from "@/lib/shared/time-travel";

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
  };
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
