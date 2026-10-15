import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Piste d'audit des tâches (TaskEvent). Chaque modification enregistre une
 * ligne avec un message lisible figé au moment de l'action (« Alice a
 * modifié la date de début du 01/10/2026 au 05/10/2026 »). Toujours appelée
 * **dans la transaction** de la modification.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type TaskEventInput = {
  taskId: string;
  actorId: string | null;
  actorName: string;
  kind: "created" | "field" | "assignee" | "supervisor" | "contributors" | "prerequisites" | "attachment" | "comment" | "session" | "node" | "risk";
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  message: string;
};

export type TaskEventDto = {
  id: string;
  kind: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  actorId: string | null;
  actorName: string;
  actorAvatarUrl: string | null;
  createdAt: string;
};

export async function recordTaskEvents(db: Db, events: TaskEventInput[]): Promise<void> {
  if (events.length === 0) return;
  await db.taskEvent.createMany({
    data: events.map((e) => ({
      taskId: e.taskId,
      actorId: e.actorId,
      actorName: e.actorName,
      kind: e.kind,
      field: e.field ?? null,
      oldValue: e.oldValue?.slice(0, 2000) ?? null,
      newValue: e.newValue?.slice(0, 2000) ?? null,
      message: e.message.slice(0, 1000),
    })),
  });
}

/** Nom affiché de l'auteur d'une action. */
export async function actorDisplayName(db: Db, userId: string): Promise<string> {
  return (await db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "Quelqu'un";
}

/** Date courte française d'un champ date (AAAA-MM-JJ → JJ/MM/AAAA). */
export function frDate(d: Date | string | null | undefined): string {
  if (!d) return "aucune";
  const iso = typeof d === "string" ? d : d.toISOString();
  const [y, m, day] = iso.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export async function listTaskEventsRaw(taskId: string, limit = 300): Promise<TaskEventDto[]> {
  const rows = await prisma.taskEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: Math.min(1000, limit),
    include: { actor: { select: { avatarUrl: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    message: r.message,
    actorId: r.actorId,
    actorName: r.actorName,
    actorAvatarUrl: r.actor?.avatarUrl ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// --- Calcul des évènements d'une modification de tâche ------------------------------------------

const STATUS: Record<string, string> = { TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CLOSED: "Clôturée" };
const PRIORITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Haute", CRITICAL: "Critique" };
const COMPLEXITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Forte" };

/** État d'une tâche utile à l'audit (avant / après). */
export type TaskSnapshot = {
  name: string;
  description: string;
  status: string;
  progress: number;
  priority: string;
  complexity: string;
  startDate: Date | null;
  dueDate: Date | null;
  closedAt: Date | null;
  assigneeId: string | null;
  supervisorId: string | null;
  contributorIds: string[];
  prerequisiteIds: string[];
  projectId: string | null;
  stageId: string | null;
  activityId: string | null;
};

const q = (s: string) => `« ${s} »`;
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Évènements d'audit entre deux états d'une tâche (noms des membres, tâches et rattachements résolus). */
export async function diffTaskEvents(db: Db, taskId: string, actorId: string, before: TaskSnapshot, after: TaskSnapshot): Promise<TaskEventInput[]> {
  const actor = await actorDisplayName(db, actorId);
  const base = { taskId, actorId, actorName: actor };
  const ev: TaskEventInput[] = [];

  const memberIds = [...new Set([before.assigneeId, after.assigneeId, before.supervisorId, after.supervisorId, ...before.contributorIds, ...after.contributorIds].filter((x): x is string => !!x))];
  const members = new Map((memberIds.length ? await db.projectMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } }) : []).map((m) => [m.id, m.name]));
  const mName = (id: string | null) => (id ? (members.get(id) ?? "un membre retiré") : "");
  const taskIds = [...new Set([...before.prerequisiteIds, ...after.prerequisiteIds])];
  const tasks = new Map((taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, name: true } }) : []).map((t) => [t.id, t.name]));
  const tName = (id: string) => q(tasks.get(id) ?? "tâche supprimée");

  if (before.name !== after.name) ev.push({ ...base, kind: "field", field: "name", oldValue: before.name, newValue: after.name, message: `${actor} a renommé la tâche de ${q(before.name)} en ${q(after.name)}` });
  if (before.description !== after.description) ev.push({ ...base, kind: "field", field: "description", oldValue: before.description, newValue: after.description, message: after.description ? `${actor} a modifié la description` : `${actor} a effacé la description` });
  if (before.status !== after.status) ev.push({ ...base, kind: "field", field: "status", oldValue: STATUS[before.status], newValue: STATUS[after.status], message: `${actor} a changé le statut de ${STATUS[before.status]} à ${STATUS[after.status]}` });
  if (before.progress !== after.progress && before.status === after.status) ev.push({ ...base, kind: "field", field: "progress", oldValue: `${before.progress} %`, newValue: `${after.progress} %`, message: `${actor} a modifié l'avancement de ${before.progress} % à ${after.progress} %` });
  if (before.priority !== after.priority) ev.push({ ...base, kind: "field", field: "priority", oldValue: PRIORITY[before.priority], newValue: PRIORITY[after.priority], message: `${actor} a changé la priorité de ${PRIORITY[before.priority]} à ${PRIORITY[after.priority]}` });
  if (before.complexity !== after.complexity) ev.push({ ...base, kind: "field", field: "complexity", oldValue: COMPLEXITY[before.complexity], newValue: COMPLEXITY[after.complexity], message: `${actor} a changé la complexité de ${COMPLEXITY[before.complexity]} à ${COMPLEXITY[after.complexity]}` });

  const dateEvent = (field: string, label: string, a: Date | null, b: Date | null) => {
    if (dayOf(a) === dayOf(b)) return;
    const message = !a ? `${actor} a fixé ${label} au ${frDate(b)}` : !b ? `${actor} a supprimé ${label} (${frDate(a)})` : `${actor} a modifié ${label} du ${frDate(a)} au ${frDate(b)}`;
    ev.push({ ...base, kind: "field", field, oldValue: a ? frDate(a) : null, newValue: b ? frDate(b) : null, message });
  };
  dateEvent("startDate", "la date de début", before.startDate, after.startDate);
  dateEvent("dueDate", "l'échéance", before.dueDate, after.dueDate);
  // La date de clôture posée / effacée par le changement de statut n'est pas redite.
  if (before.status === after.status) dateEvent("closedAt", "la date de clôture", before.closedAt, after.closedAt);

  if (before.assigneeId !== after.assigneeId) {
    const message = !before.assigneeId
      ? `${actor} a assigné la tâche à ${mName(after.assigneeId)}`
      : !after.assigneeId
        ? `${actor} a retiré l'assignation de ${mName(before.assigneeId)}`
        : `${actor} a réassigné la tâche de ${mName(before.assigneeId)} à ${mName(after.assigneeId)}`;
    ev.push({ ...base, kind: "assignee", field: "assigneeId", oldValue: mName(before.assigneeId) || null, newValue: mName(after.assigneeId) || null, message });
  }
  if (before.supervisorId !== after.supervisorId) {
    const message = !after.supervisorId
      ? `${actor} a retiré ${mName(before.supervisorId)} de la supervision`
      : `${actor} a désigné ${mName(after.supervisorId)} comme superviseur${before.supervisorId ? ` (à la place de ${mName(before.supervisorId)})` : ""}`;
    ev.push({ ...base, kind: "supervisor", field: "supervisorId", oldValue: mName(before.supervisorId) || null, newValue: mName(after.supervisorId) || null, message });
  }
  for (const id of after.contributorIds.filter((x) => !before.contributorIds.includes(x))) ev.push({ ...base, kind: "contributors", field: "contributorIds", newValue: mName(id), message: `${actor} a ajouté ${mName(id)} aux contributeurs` });
  for (const id of before.contributorIds.filter((x) => !after.contributorIds.includes(x))) ev.push({ ...base, kind: "contributors", field: "contributorIds", oldValue: mName(id), message: `${actor} a retiré ${mName(id)} des contributeurs` });
  for (const id of after.prerequisiteIds.filter((x) => !before.prerequisiteIds.includes(x))) ev.push({ ...base, kind: "prerequisites", field: "prerequisiteIds", newValue: tasks.get(id) ?? id, message: `${actor} a ajouté le prérequis ${tName(id)}` });
  for (const id of before.prerequisiteIds.filter((x) => !after.prerequisiteIds.includes(x))) ev.push({ ...base, kind: "prerequisites", field: "prerequisiteIds", oldValue: tasks.get(id) ?? id, message: `${actor} a retiré le prérequis ${tName(id)}` });

  if (before.projectId !== after.projectId || before.stageId !== after.stageId || before.activityId !== after.activityId) {
    const where = async (s: { projectId: string | null; stageId: string | null; activityId: string | null }) => {
      if (!s.projectId) return "Sans projet";
      const [p, st, ac] = await Promise.all([
        db.project.findUnique({ where: { id: s.projectId }, select: { name: true } }),
        s.stageId ? db.stage.findUnique({ where: { id: s.stageId }, select: { name: true } }) : null,
        s.activityId ? db.activity.findUnique({ where: { id: s.activityId }, select: { name: true } }) : null,
      ]);
      return [p?.name, st?.name, ac?.name].filter(Boolean).join(" › ");
    };
    const [from, to] = await Promise.all([where(before), where(after)]);
    ev.push({ ...base, kind: "attachment", field: "attachment", oldValue: from, newValue: to, message: `${actor} a déplacé la tâche de ${q(from)} vers ${q(to)}` });
  }
  return ev;
}

/** Instantané d'audit d'une tâche (avec ses contributeurs). */
export async function taskSnapshot(db: Db, taskId: string): Promise<TaskSnapshot | null> {
  const t = await db.task.findUnique({ where: { id: taskId }, include: { contributors: { select: { memberId: true } } } });
  if (!t) return null;
  return {
    name: t.name,
    description: t.description,
    status: t.status,
    progress: t.progress,
    priority: t.priority,
    complexity: t.complexity,
    startDate: t.startDate,
    dueDate: t.dueDate,
    closedAt: t.closedAt,
    assigneeId: t.assigneeId,
    supervisorId: t.supervisorId,
    contributorIds: t.contributors.map((c) => c.memberId).sort(),
    prerequisiteIds: [...t.prerequisiteIds].sort(),
    projectId: t.projectId,
    stageId: t.stageId,
    activityId: t.activityId,
  };
}
