import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, forbidden, notFound } from "@/lib/api";
import { projectAccessWhere } from "@/lib/projects";
import { actorDisplayName } from "@/lib/task-events";
import type { BaselineData, BaselineDto, BaselineSummary } from "@/lib/shared/baseline";

/**
 * Plannings de référence (baselines) d'un projet : instantanés figés des
 * dates des étapes et des tâches, comparés au planning réel dans le Gantt
 * (barres fantômes, glissement en jours). Lecture et création : toute
 * personne ayant accès au projet ; suppression : son auteur ou le
 * propriétaire du projet. Projets types exclus (pas de dates).
 */

export const MAX_BASELINES = 20;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function requireAccess(userId: string, projectId: string) {
  const p = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true, ownerId: true } });
  if (!p) throw notFound("Projet");
  return p;
}

function toSummary(b: { id: string; name: string; createdAt: Date; createdById: string | null; createdByName: string; taskCount: number }): BaselineSummary {
  return { id: b.id, name: b.name, createdAt: b.createdAt.toISOString(), createdById: b.createdById, createdByName: b.createdByName, taskCount: b.taskCount };
}

export async function listBaselines(userId: string, projectId: string): Promise<BaselineSummary[]> {
  await requireAccess(userId, projectId);
  const rows = await prisma.projectBaseline.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, createdById: true, createdByName: true, taskCount: true },
  });
  return rows.map(toSummary);
}

export async function getBaseline(userId: string, projectId: string, baselineId: string): Promise<BaselineDto> {
  await requireAccess(userId, projectId);
  const b = await prisma.projectBaseline.findFirst({ where: { id: baselineId, projectId } });
  if (!b) throw notFound("Planning de référence");
  return { ...toSummary(b), data: b.data as unknown as BaselineData };
}

/** Fige le planning actuel (dates des étapes et des tâches) sous un nom. */
export async function createBaseline(userId: string, projectId: string, name: string): Promise<BaselineDto> {
  await requireAccess(userId, projectId);
  return prisma.$transaction(async (tx) => {
    // Verrou de ligne du projet : pas d'instantané au milieu d'une mutation.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const count = await tx.projectBaseline.count({ where: { projectId } });
    if (count >= MAX_BASELINES) throw new ApiError(409, "LIMIT", `${MAX_BASELINES} plannings de référence au plus : supprimez-en un d'abord.`);
    const [stages, tasks] = await Promise.all([
      tx.stage.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { id: true, name: true, startDate: true, dueDate: true } }),
      tx.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }], select: { id: true, name: true, stageId: true, startDate: true, dueDate: true } }),
    ]);
    const data: BaselineData = {
      stages: stages.map((s) => ({ id: s.id, name: s.name, startDate: day(s.startDate), dueDate: day(s.dueDate) })),
      tasks: tasks.map((t) => ({ id: t.id, name: t.name, stageId: t.stageId, startDate: day(t.startDate), dueDate: day(t.dueDate) })),
    };
    const b = await tx.projectBaseline.create({
      data: {
        projectId,
        name,
        createdById: userId,
        createdByName: await actorDisplayName(tx, userId),
        data: data as unknown as Prisma.InputJsonValue,
        taskCount: tasks.filter((t) => t.startDate || t.dueDate).length,
      },
    });
    return { ...toSummary(b), data };
  });
}

export async function renameBaseline(userId: string, projectId: string, baselineId: string, name: string): Promise<BaselineSummary> {
  const p = await requireAccess(userId, projectId);
  const b = await prisma.projectBaseline.findFirst({ where: { id: baselineId, projectId }, select: { createdById: true } });
  if (!b) throw notFound("Planning de référence");
  if (b.createdById !== userId && p.ownerId !== userId) throw forbidden();
  return toSummary(await prisma.projectBaseline.update({ where: { id: baselineId }, data: { name } }));
}

export async function deleteBaseline(userId: string, projectId: string, baselineId: string): Promise<void> {
  const p = await requireAccess(userId, projectId);
  const b = await prisma.projectBaseline.findFirst({ where: { id: baselineId, projectId }, select: { createdById: true } });
  if (!b) throw notFound("Planning de référence");
  if (b.createdById !== userId && p.ownerId !== userId) throw forbidden();
  await prisma.projectBaseline.delete({ where: { id: baselineId } });
}
