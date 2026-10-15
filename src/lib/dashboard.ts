import "server-only";
import type { DeliverableStatus, Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TASK_PEOPLE_SELECT, isMyTask, listProjects, taskAccessWhere, toTaskDto, type ProjectSummary, type TaskDto } from "@/lib/projects";
import { NO_PROJECT_LABEL, tasksOfUsersWhere } from "@/lib/tasks";

/**
 * Tableau de bord personnel : mes tâches (affectées à un membre rattaché à
 * mon compte, ou non affectées dans mes propres projets), échéances à venir, répartition par statut, avancement global.
 * Exposé par GET /api/v1/dashboard (web et mobile).
 */

export type DashboardTask = TaskDto & {
  /** null = sans projet. */
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  stageName: string | null;
  assigneeName: string | null;
};

export type Deadline = {
  kind: "task" | "deliverable";
  id: string;
  name: string;
  /** null = tâche sans projet. */
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  dueDate: string;
  status: string;
  assigneeName: string | null;
  /** Jours restants (négatif = en retard). */
  daysLeft: number;
  mine: boolean;
};

export type DashboardDto = {
  projects: ProjectSummary[];
  /** Mes tâches **ouvertes**, par échéance (100 au plus). */
  myTasks: DashboardTask[];
  /** Nombre exact de mes tâches ouvertes. */
  myOpenCount: number;
  /** Échéances (retards inclus) sous l’horizon, les plus urgentes d’abord (100 au plus). */
  deadlines: Deadline[];
  /** Nombre exact d’échéances dans les 7 prochains jours (tâches et livrables). */
  next7Count: number;
  /** Toutes les tâches de mes projets, par statut. */
  statusCounts: Record<TaskStatus, number>;
  /** Mes tâches, par statut. */
  myStatusCounts: Record<TaskStatus, number>;
  deliverableCounts: Record<DeliverableStatus, number>;
  overdueCount: number;
  globalProgress: { percent: number; total: number; done: number };
};

const DAY = 24 * 60 * 60 * 1000;

function daysLeft(due: Date, now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((end - start) / DAY);
}

/** Taille maximale des listes renvoyées (les compteurs, eux, sont exacts). */
export const DASHBOARD_LIST_LIMIT = 100;

const DONE_STATUSES: TaskStatus[] = ["DONE", "CLOSED"];

export async function getDashboard(userId: string, options: { horizonDays?: number } = {}): Promise<DashboardDto> {
  const horizon = options.horizonDays ?? 30;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const plus = (days: number) => new Date(today.getTime() + days * DAY);
  const projects = await listProjects(userId);
  const activeIds = projects.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD").map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Périmètre : tâches accessibles des projets actifs / en pause, et tâches sans projet.
  const scope: Prisma.TaskWhereInput = { AND: [taskAccessWhere(userId), { OR: [{ projectId: { in: activeIds } }, { projectId: null }] }] };
  const mineScope: Prisma.TaskWhereInput = { AND: [scope, tasksOfUsersWhere([userId])] };
  const open: Prisma.TaskWhereInput = { status: { notIn: DONE_STATUSES } };
  const deliverableOpen: Prisma.DeliverableWhereInput = { projectId: { in: activeIds }, status: { in: ["PLANNED", "IN_PROGRESS"] } };
  const taskInclude = {
    _count: { select: { comments: true } },
    nodes: { select: { nodeId: true } },
    ...TASK_PEOPLE_SELECT,
    stage: { select: { name: true } },
    project: { select: { id: true, name: true, color: true, ownerId: true } },
  } satisfies Prisma.TaskInclude;

  // Compteurs en base (exacts) ; listes plafonnées (DASHBOARD_LIST_LIMIT).
  const [byStatus, mineByStatus, progressAgg, overdueTasks, myOpen, deadlineTasks, deliverableGroups, deliverableDeadlines, overdueDeliverables] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["status"], where: mineScope, _count: { _all: true } }),
    prisma.task.aggregate({ where: scope, _avg: { progress: true } }),
    prisma.task.count({ where: { AND: [scope, open, { dueDate: { lt: today } }] } }),
    prisma.task.findMany({ where: { AND: [mineScope, open] }, include: taskInclude, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }], take: DASHBOARD_LIST_LIMIT }),
    prisma.task.findMany({ where: { AND: [scope, open, { dueDate: { lt: plus(horizon + 1) } }] }, include: taskInclude, orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }], take: DASHBOARD_LIST_LIMIT }),
    prisma.deliverable.groupBy({ by: ["status"], where: { projectId: { in: activeIds } }, _count: { _all: true } }),
    prisma.deliverable.findMany({
      where: { ...deliverableOpen, expectedEnd: { lt: plus(horizon + 1) } },
      include: { assignee: { select: { name: true, userId: true } } },
      orderBy: { expectedEnd: "asc" },
      take: DASHBOARD_LIST_LIMIT,
    }),
    prisma.deliverable.count({ where: { ...deliverableOpen, expectedEnd: { lt: today } } }),
  ]);
  const [next7Tasks, next7Deliverables] = await Promise.all([
    prisma.task.count({ where: { AND: [scope, open, { dueDate: { gte: today, lt: plus(8) } }] } }),
    prisma.deliverable.count({ where: { ...deliverableOpen, expectedEnd: { gte: today, lt: plus(8) } } }),
  ]);

  const statusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
  for (const g of byStatus) statusCounts[g.status] = g._count._all;
  const myStatusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
  for (const g of mineByStatus) myStatusCounts[g.status] = g._count._all;
  const deliverableCounts: Record<DeliverableStatus, number> = { PLANNED: 0, IN_PROGRESS: 0, DELIVERED: 0, VALIDATED: 0 };
  for (const g of deliverableGroups) deliverableCounts[g.status] = g._count._all;

  type Row = (typeof myOpen)[number];
  const projectOf = (t: Row) => t.project ?? { id: null, name: NO_PROJECT_LABEL, color: null, ownerId: t.ownerId };
  const myTasks: DashboardTask[] = myOpen.map((t) => {
    const project = projectOf(t);
    return { ...toTaskDto(t), projectId: project.id, projectName: project.name, projectColor: project.color, stageName: t.stage?.name ?? null, assigneeName: t.assignee?.name ?? null };
  });

  const deadlines: Deadline[] = deadlineTasks.map((t) => {
    const project = projectOf(t);
    return {
      kind: "task",
      id: t.id,
      name: t.name,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
      dueDate: t.dueDate!.toISOString(),
      status: t.status,
      assigneeName: t.assignee?.name ?? null,
      daysLeft: daysLeft(t.dueDate!, now),
      mine: isMyTask(t, project.ownerId, userId),
    };
  });
  for (const d of deliverableDeadlines) {
    const project = projectById.get(d.projectId)!;
    deadlines.push({
      kind: "deliverable",
      id: d.id,
      name: d.name,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
      dueDate: d.expectedEnd!.toISOString(),
      status: d.status,
      assigneeName: d.assignee?.name ?? null,
      daysLeft: daysLeft(d.expectedEnd!, now),
      mine: d.assignee?.userId === userId,
    });
  }
  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);
  deadlines.length = Math.min(deadlines.length, DASHBOARD_LIST_LIMIT);

  const active = projects.filter((p) => activeIds.includes(p.id));
  const total = active.reduce((a, p) => a + p.progress.total, 0);
  const done = active.reduce((a, p) => a + p.progress.done, 0);

  return {
    projects,
    myTasks,
    myOpenCount: myStatusCounts.TODO + myStatusCounts.IN_PROGRESS,
    deadlines,
    next7Count: next7Tasks + next7Deliverables,
    statusCounts,
    myStatusCounts,
    deliverableCounts,
    overdueCount: overdueTasks + overdueDeliverables,
    globalProgress: { percent: Math.round(progressAgg._avg.progress ?? 0), total, done },
  };
}
