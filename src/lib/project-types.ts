import "server-only";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { projectAccessWhere } from "@/lib/projects";
import type { ProjectTypesDto } from "@/lib/shared/project-types";

/**
 * Types de projet personnels (« Client », « Interne »…) : chaque utilisateur
 * crée ses types, les ordonne et y range les projets qu'il voit (liste des
 * projets groupée, épingles du menu groupées au-delà de 5). Le classement
 * est propre à chacun : il ne modifie pas le projet et ne se voit pas des
 * autres membres. « Sans projet » n'est pas un projet : rien à ranger.
 */

export const MAX_PROJECT_TYPES = 50;

export async function listProjectTypes(userId: string): Promise<ProjectTypesDto> {
  const [types, links] = await Promise.all([
    prisma.projectType.findMany({ where: { userId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    prisma.projectTypeLink.findMany({ where: { userId, project: projectAccessWhere(userId) }, select: { projectId: true, typeId: true } }),
  ]);
  return { types, assignments: Object.fromEntries(links.map((l) => [l.projectId, l.typeId])) };
}

async function ownType(userId: string, typeId: string) {
  const t = await prisma.projectType.findFirst({ where: { id: typeId, userId }, select: { id: true } });
  if (!t) throw notFound("Type de projet");
  return t;
}

export async function createProjectType(userId: string, name: string): Promise<ProjectTypesDto> {
  const clean = name.trim();
  if ((await prisma.projectType.count({ where: { userId } })) >= MAX_PROJECT_TYPES) throw badRequest(`${MAX_PROJECT_TYPES} types de projet au plus.`);
  if (await prisma.projectType.findFirst({ where: { userId, name: { equals: clean, mode: "insensitive" } }, select: { id: true } })) throw badRequest(`Le type « ${clean} » existe déjà.`);
  const last = await prisma.projectType.aggregate({ where: { userId }, _max: { order: true } });
  await prisma.projectType.create({ data: { userId, name: clean, order: (last._max.order ?? -1) + 1 } });
  return listProjectTypes(userId);
}

export async function renameProjectType(userId: string, typeId: string, name: string): Promise<ProjectTypesDto> {
  await ownType(userId, typeId);
  const clean = name.trim();
  if (await prisma.projectType.findFirst({ where: { userId, id: { not: typeId }, name: { equals: clean, mode: "insensitive" } }, select: { id: true } })) throw badRequest(`Le type « ${clean} » existe déjà.`);
  await prisma.projectType.update({ where: { id: typeId }, data: { name: clean } });
  return listProjectTypes(userId);
}

/** Supprime le type : ses projets redeviennent « sans type ». */
export async function deleteProjectType(userId: string, typeId: string): Promise<ProjectTypesDto> {
  await ownType(userId, typeId);
  await prisma.projectType.delete({ where: { id: typeId } });
  return listProjectTypes(userId);
}

/** Nouvel ordre des types (liste complète de mes types). */
export async function reorderProjectTypes(userId: string, ids: string[]): Promise<ProjectTypesDto> {
  const mine = await prisma.projectType.findMany({ where: { userId }, select: { id: true } });
  const set = new Set(mine.map((t) => t.id));
  if (ids.length !== set.size || new Set(ids).size !== ids.length || ids.some((id) => !set.has(id))) throw badRequest("L'ordre doit lister tous vos types de projet, une fois chacun.");
  await prisma.$transaction(ids.map((id, order) => prisma.projectType.update({ where: { id }, data: { order } })));
  return listProjectTypes(userId);
}

/** Range un projet (accessible) dans un de mes types, ou le retire de son type (`typeId` null). */
export async function assignProjectType(userId: string, projectId: string, typeId: string | null): Promise<ProjectTypesDto> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true } });
  if (!project) throw notFound("Projet");
  if (typeId === null) {
    await prisma.projectTypeLink.deleteMany({ where: { userId, projectId } });
  } else {
    await ownType(userId, typeId);
    await prisma.projectTypeLink.upsert({ where: { userId_projectId: { userId, projectId } }, create: { userId, projectId, typeId }, update: { typeId } });
  }
  return listProjectTypes(userId);
}
