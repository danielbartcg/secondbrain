import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { tasksOfUsersWhere } from "@/lib/tasks";

/**
 * Fraîcheur : repère les tâches ouvertes et les projets actifs **sans
 * activité** depuis N jours (`User.staleDays`, 14 par défaut). Activité d'une
 * tâche = dernière écriture sur sa ligne ou dernier évènement de sa piste
 * d'audit (commentaire, session, rattachement… qui ne touchent pas la ligne).
 * Activité d'un projet = la plus récente de : projet, étapes, livrables,
 * risques, réunions, documents, tâches et leurs pistes d'audit.
 * Toujours calculé en base, borné ; en ligne uniquement.
 */

const DAY_MS = 86_400_000;
const OPEN_STATUSES = ["TODO", "IN_PROGRESS"] as const;
export const STALE_LIST_LIMIT = 50;

export type StaleTask = {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  lastActivityAt: string;
  idleDays: number;
};

export type StaleProject = { id: string; name: string; color: string | null; lastActivityAt: string; idleDays: number };

export type StaleOverview = { days: number; tasks: StaleTask[]; taskCount: number; projects: StaleProject[] };

const idle = (d: Date, now: number) => Math.floor((now - d.getTime()) / DAY_MS);
const later = (a: Date, b: Date | null | undefined) => (b && b > a ? b : a);

/** Dernier évènement d'audit par tâche. */
async function lastTaskEvents(taskIds: string[]): Promise<Map<string, Date>> {
  if (!taskIds.length) return new Map();
  const rows = await prisma.taskEvent.groupBy({ by: ["taskId"], where: { taskId: { in: taskIds } }, _max: { createdAt: true } });
  return new Map(rows.filter((r) => r._max.createdAt).map((r) => [r.taskId, r._max.createdAt!]));
}

/** Tâches ouvertes de la liste dont la dernière activité est antérieure au seuil. */
async function staleAmong(rows: { id: string; updatedAt: Date }[], threshold: Date): Promise<Map<string, Date>> {
  const events = await lastTaskEvents(rows.map((r) => r.id));
  const out = new Map<string, Date>();
  for (const r of rows) {
    const last = later(r.updatedAt, events.get(r.id));
    if (last < threshold) out.set(r.id, last);
  }
  return out;
}

/** Dernière activité de chaque projet (voir l'en-tête). */
export async function projectsLastActivity(projectIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!projectIds.length) return out;
  const bump = (id: string | null, d: Date | null | undefined) => {
    if (id && d) out.set(id, later(out.get(id) ?? d, d));
  };
  const inIds = { projectId: { in: projectIds } };
  const [projects, stages, deliverables, risks, meetings, documents, tasks, events] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, updatedAt: true } }),
    prisma.stage.groupBy({ by: ["projectId"], where: inIds, _max: { updatedAt: true } }),
    prisma.deliverable.groupBy({ by: ["projectId"], where: inIds, _max: { updatedAt: true } }),
    prisma.risk.groupBy({ by: ["projectId"], where: inIds, _max: { updatedAt: true } }),
    prisma.meeting.groupBy({ by: ["projectId"], where: inIds, _max: { updatedAt: true } }),
    prisma.document.groupBy({ by: ["projectId"], where: inIds, _max: { createdAt: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: inIds, _max: { updatedAt: true } }),
    prisma.$queryRaw<{ projectId: string; last: Date }[]>`
      SELECT t."projectId" AS "projectId", MAX(e."createdAt") AS "last"
      FROM "TaskEvent" e JOIN "Task" t ON t.id = e."taskId"
      WHERE t."projectId" IN (${Prisma.join(projectIds)})
      GROUP BY t."projectId"`,
  ]);
  for (const p of projects) bump(p.id, p.updatedAt);
  for (const r of stages) bump(r.projectId, r._max.updatedAt);
  for (const r of deliverables) bump(r.projectId, r._max.updatedAt);
  for (const r of risks) bump(r.projectId, r._max.updatedAt);
  for (const r of meetings) bump(r.projectId, r._max.updatedAt);
  for (const r of documents) bump(r.projectId, r._max.createdAt);
  for (const r of tasks) bump(r.projectId, r._max.updatedAt);
  for (const r of events) bump(r.projectId, r.last);
  return out;
}

/**
 * Vue d'ensemble pour le tableau de bord et la liste des projets : mes tâches
 * ouvertes endormies (projets actifs / en pause et sans projet ; les plus
 * anciennes d'abord, 50 au plus, total exact) et mes projets **actifs**
 * endormis (tous).
 */
export async function getStaleOverview(userId: string, days: number): Promise<StaleOverview> {
  const now = Date.now();
  const threshold = new Date(now - days * DAY_MS);
  // Préfiltre : une tâche endormie a forcément une ligne plus ancienne que le seuil.
  const candidates = await prisma.task.findMany({
    where: {
      AND: [
        taskAccessWhere(userId),
        tasksOfUsersWhere([userId]),
        { status: { in: [...OPEN_STATUSES] }, updatedAt: { lt: threshold } },
        { OR: [{ projectId: null }, { project: { status: { in: ["ACTIVE", "ON_HOLD"] } } }] },
      ],
    },
    select: { id: true, updatedAt: true },
  });
  const stale = await staleAmong(candidates, threshold);
  const ids = [...stale.entries()].sort((a, b) => a[1].getTime() - b[1].getTime()).map(([id]) => id);
  const shown = ids.slice(0, STALE_LIST_LIMIT);
  const rows = shown.length
    ? await prisma.task.findMany({ where: { id: { in: shown } }, select: { id: true, name: true, status: true, dueDate: true, projectId: true, project: { select: { name: true } } } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tasks: StaleTask[] = shown
    .map((id) => {
      const t = byId.get(id);
      if (!t) return null;
      const last = stale.get(id)!;
      return { id, name: t.name, status: t.status as string, dueDate: t.dueDate?.toISOString() ?? null, projectId: t.projectId, projectName: t.project?.name ?? null, lastActivityAt: last.toISOString(), idleDays: idle(last, now) };
    })
    .filter((x): x is StaleTask => !!x);

  const projects = await prisma.project.findMany({ where: { ...projectAccessWhere(userId), status: "ACTIVE", updatedAt: { lt: threshold } }, select: { id: true, name: true, color: true } });
  const last = await projectsLastActivity(projects.map((p) => p.id));
  const staleProjects = projects
    .map((p) => ({ p, d: last.get(p.id)! }))
    .filter((x) => x.d && x.d < threshold)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map(({ p, d }) => ({ id: p.id, name: p.name, color: p.color, lastActivityAt: d.toISOString(), idleDays: idle(d, now) }));

  return { days, tasks, taskCount: ids.length, projects: staleProjects };
}

/** Fraîcheur d'un projet : ses tâches ouvertes endormies (toutes) et sa dernière activité. */
export async function getProjectStale(userId: string, projectId: string, days: number): Promise<{ days: number; lastActivityAt: string | null; tasks: Record<string, string> }> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true } });
  if (!p) throw notFound("Projet");
  const threshold = new Date(Date.now() - days * DAY_MS);
  const candidates = await prisma.task.findMany({ where: { projectId, status: { in: [...OPEN_STATUSES] }, updatedAt: { lt: threshold } }, select: { id: true, updatedAt: true } });
  const stale = await staleAmong(candidates, threshold);
  const last = (await projectsLastActivity([projectId])).get(projectId) ?? null;
  return { days, lastActivityAt: last?.toISOString() ?? null, tasks: Object.fromEntries([...stale].map(([id, d]) => [id, d.toISOString()])) };
}
