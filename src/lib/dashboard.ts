import "server-only";
import type { DeliverableStatus, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TASK_PEOPLE_SELECT, isMyTask, listProjects, taskAccessWhere, toTaskDto, type ProjectSummary, type TaskDto } from "@/lib/projects";
import { NO_PROJECT_LABEL } from "@/lib/tasks";

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
  myTasks: DashboardTask[];
  deadlines: Deadline[];
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

export async function getDashboard(userId: string, options: { horizonDays?: number } = {}): Promise<DashboardDto> {
  const horizon = options.horizonDays ?? 30;
  const now = new Date();
  const projects = await listProjects(userId);
  const activeIds = projects.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD").map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const [tasks, deliverables] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [taskAccessWhere(userId), { OR: [{ projectId: { in: activeIds } }, { projectId: null }] }] },
      include: {
        _count: { select: { comments: true } },
        nodes: { select: { nodeId: true } },
        ...TASK_PEOPLE_SELECT,
        stage: { select: { name: true } },
        project: { select: { id: true, name: true, color: true, ownerId: true } },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.deliverable.findMany({
      where: { projectId: { in: activeIds } },
      include: { assignee: { select: { name: true, userId: true } } },
    }),
  ]);

  const statusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
  const myStatusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
  const myTasks: DashboardTask[] = [];
  const deadlines: Deadline[] = [];
  let overdueCount = 0;

  for (const t of tasks) {
    statusCounts[t.status]++;
    // Tâche sans projet : projet virtuel « Sans projet », visible par son créateur seulement.
    const project = t.project ?? { id: null, name: NO_PROJECT_LABEL, color: null, ownerId: t.ownerId };
    const mine = isMyTask(t, project.ownerId, userId);
    if (mine) {
      myStatusCounts[t.status]++;
      myTasks.push({
        ...toTaskDto(t),
        projectId: project.id,
        projectName: project.name,
        projectColor: project.color,
        stageName: t.stage?.name ?? null,
        assigneeName: t.assignee?.name ?? null,
      });
    }
    if (t.dueDate && t.status !== "DONE" && t.status !== "CLOSED") {
      const left = daysLeft(t.dueDate, now);
      if (left < 0) overdueCount++;
      if (left <= horizon) {
        deadlines.push({
          kind: "task",
          id: t.id,
          name: t.name,
          projectId: project.id,
          projectName: project.name,
          projectColor: project.color,
          dueDate: t.dueDate.toISOString(),
          status: t.status,
          assigneeName: t.assignee?.name ?? null,
          daysLeft: left,
          mine,
        });
      }
    }
  }

  const deliverableCounts: Record<DeliverableStatus, number> = { PLANNED: 0, IN_PROGRESS: 0, DELIVERED: 0, VALIDATED: 0 };
  for (const d of deliverables) {
    deliverableCounts[d.status]++;
    if (d.expectedEnd && (d.status === "PLANNED" || d.status === "IN_PROGRESS")) {
      const left = daysLeft(d.expectedEnd, now);
      if (left < 0) overdueCount++;
      if (left <= horizon) {
        const project = projectById.get(d.projectId)!;
        deadlines.push({
          kind: "deliverable",
          id: d.id,
          name: d.name,
          projectId: project.id,
          projectName: project.name,
          projectColor: project.color,
          dueDate: d.expectedEnd.toISOString(),
          status: d.status,
          assigneeName: d.assignee?.name ?? null,
          daysLeft: left,
          mine: d.assignee?.userId === userId,
        });
      }
    }
  }
  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  // Mes tâches : les non terminées d'abord, par échéance.
  const finished = (s: TaskStatus) => s === "DONE" || s === "CLOSED";
  myTasks.sort((a, b) => {
    if (finished(a.status) !== finished(b.status)) return finished(a.status) ? 1 : -1;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  const active = projects.filter((p) => activeIds.includes(p.id));
  const total = active.reduce((a, p) => a + p.progress.total, 0);
  const done = active.reduce((a, p) => a + p.progress.done, 0);
  const sum = tasks.reduce((a, t) => a + t.progress, 0);

  return {
    projects,
    myTasks,
    deadlines,
    statusCounts,
    myStatusCounts,
    deliverableCounts,
    overdueCount,
    globalProgress: { percent: tasks.length ? Math.round(sum / tasks.length) : 0, total, done },
  };
}
