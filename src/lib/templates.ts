import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { getProject, mutateProject, requireProjectAccess, type ProjectDto } from "@/lib/projects";
import { getMindMap, type MindMapDto } from "@/lib/mindmaps";
import { requireMapAccess } from "@/lib/map-access";
import { recordTaskEvents, actorDisplayName } from "@/lib/task-events";
import { recordMapEvents } from "@/lib/map-events";

/**
 * Modèles (Administration → Modèles) : projets types et cartes types.
 *
 * Un modèle est un vrai projet / une vraie carte marqué `isTemplate` : il
 * s'édite avec les mêmes écrans (qui masquent alors ce qui relève d'une
 * instance : dates, équipe, affectations, statuts, réunions, documents…),
 * reste hors des périmètres habituels (listes, tableau de bord, recherche,
 * synchro, activité) et n'est modifiable que par les administrateurs.
 *
 * Appliquer un modèle copie sa **structure** dans un projet / une carte
 * (à la création, ou ensuite tant que la cible est vide) :
 *  - projet : étapes, activités, tâches (nom, description, notes, priorité,
 *    complexité, ordre, prérequis), livrables, risques et opportunités (avec
 *    leurs tâches liées), arborescence des dossiers ; description, notes et
 *    couleur si la cible n'en a pas. Jamais : dates, équipe, affectations,
 *    statuts (tout repart « à faire » / « ouvert »), réunions, documents.
 *  - carte : tous les nœuds (titre, notes, couleur, statut, ordre, repli,
 *    positions) sous la racine ; notes et couleur de la racine si vides.
 */

const newId = (p: string) => p + randomBytes(12).toString("hex");

export type ProjectTemplateSummary = { id: string; name: string; description: string; color: string | null; stageCount: number; taskCount: number; riskCount: number; deliverableCount: number; updatedAt: string };
export type MapTemplateSummary = { id: string; title: string; nodeCount: number; updatedAt: string };
export type TemplatesDto = { projects: ProjectTemplateSummary[]; maps: MapTemplateSummary[] };

/** Modèles disponibles (tout utilisateur connecté : choix à la création). */
export async function listTemplates(): Promise<TemplatesDto> {
  const [projects, maps] = await Promise.all([
    prisma.project.findMany({
      where: { isTemplate: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, color: true, updatedAt: true, _count: { select: { stages: true, tasks: true, risks: true, deliverables: true } } },
    }),
    prisma.mindMap.findMany({ where: { isTemplate: true }, orderBy: { title: "asc" }, select: { id: true, title: true, updatedAt: true, _count: { select: { nodes: true } } } }),
  ]);
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      stageCount: p._count.stages,
      taskCount: p._count.tasks,
      riskCount: p._count.risks,
      deliverableCount: p._count.deliverables,
      updatedAt: p.updatedAt.toISOString(),
    })),
    maps: maps.map((m) => ({ id: m.id, title: m.title, nodeCount: Math.max(0, m._count.nodes - 1), updatedAt: m.updatedAt.toISOString() })),
  };
}

// --- Copie de structure (projets) ------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** Le projet n'a encore aucun contenu structurel (étapes, tâches, livrables, risques, dossiers). */
async function projectIsEmpty(tx: Tx | typeof prisma, projectId: string): Promise<boolean> {
  const [stages, tasks, deliverables, risks, folders] = await Promise.all([
    tx.stage.count({ where: { projectId } }),
    tx.task.count({ where: { projectId } }),
    tx.deliverable.count({ where: { projectId } }),
    tx.risk.count({ where: { projectId } }),
    tx.folder.count({ where: { projectId } }),
  ]);
  return stages + tasks + deliverables + risks + folders === 0;
}

/** Copie la structure de `sourceId` dans `targetId` (dans la transaction verrouillant la cible). */
async function copyProjectStructure(tx: Tx, userId: string, sourceId: string, targetId: string, label: string): Promise<{ tasks: number }> {
  const [source, target, stages, activities, tasks, deliverables, risks, folders] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: sourceId }, select: { description: true, notes: true, color: true } }),
    tx.project.findUniqueOrThrow({ where: { id: targetId }, select: { description: true, notes: true, color: true } }),
    tx.stage.findMany({ where: { projectId: sourceId } }),
    tx.activity.findMany({ where: { stage: { projectId: sourceId } } }),
    tx.task.findMany({ where: { projectId: sourceId } }),
    tx.deliverable.findMany({ where: { projectId: sourceId } }),
    tx.risk.findMany({ where: { projectId: sourceId }, include: { tasks: { select: { taskId: true } } } }),
    tx.folder.findMany({ where: { projectId: sourceId } }),
  ]);
  const stageMap = new Map(stages.map((s) => [s.id, newId("c")]));
  const actMap = new Map(activities.map((a) => [a.id, newId("c")]));
  const taskMap = new Map(tasks.map((t) => [t.id, newId("c")]));
  const folderMap = new Map(folders.map((f) => [f.id, newId("c")]));

  await tx.project.update({
    where: { id: targetId },
    data: {
      ...(!target.description.trim() && source.description ? { description: source.description } : {}),
      ...(!target.notes.trim() && source.notes ? { notes: source.notes } : {}),
      ...(!target.color && source.color ? { color: source.color } : {}),
    },
  });
  if (stages.length) {
    await tx.stage.createMany({ data: stages.map((s) => ({ id: stageMap.get(s.id)!, projectId: targetId, name: s.name, description: s.description, notes: s.notes, order: s.order })) });
  }
  if (activities.length) {
    await tx.activity.createMany({ data: activities.map((a) => ({ id: actMap.get(a.id)!, stageId: stageMap.get(a.stageId)!, name: a.name, description: a.description, notes: a.notes, order: a.order })) });
  }
  if (tasks.length) {
    await tx.task.createMany({
      data: tasks.map((t) => ({
        id: taskMap.get(t.id)!,
        ownerId: userId,
        projectId: targetId,
        stageId: t.stageId ? (stageMap.get(t.stageId) ?? null) : null,
        activityId: t.activityId ? (actMap.get(t.activityId) ?? null) : null,
        name: t.name,
        description: t.description,
        notes: t.notes,
        priority: t.priority,
        complexity: t.complexity,
        order: t.order,
        status: "TODO" as const,
        progress: 0,
        prerequisiteIds: t.prerequisiteIds.map((p) => taskMap.get(p)).filter((p): p is string => !!p),
      })),
    });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(
      tx,
      tasks.map((t) => ({ taskId: taskMap.get(t.id)!, actorId: userId, actorName: actor, kind: "created" as const, message: `${actor} a créé la tâche « ${t.name} » (modèle « ${label} »)` })),
    );
  }
  if (deliverables.length) {
    await tx.deliverable.createMany({
      data: deliverables.map((d) => ({ projectId: targetId, stageId: d.stageId ? (stageMap.get(d.stageId) ?? null) : null, name: d.name, description: d.description, order: d.order, status: "PLANNED" as const })),
    });
  }
  for (const r of risks) {
    const rid = newId("c");
    await tx.risk.create({
      data: {
        id: rid,
        projectId: targetId,
        kind: r.kind,
        title: r.title,
        description: r.description,
        category: r.category,
        probability: r.probability,
        impact: r.impact,
        response: r.response,
        strategy: r.strategy,
        order: r.order,
        status: "OPEN",
      },
    });
    const links = r.tasks.map((l) => taskMap.get(l.taskId)).filter((x): x is string => !!x);
    if (links.length) await tx.riskTask.createMany({ data: links.map((taskId) => ({ riskId: rid, taskId })) });
  }
  // Dossiers : parents d'abord.
  const pending = [...folders];
  while (pending.length) {
    const ready = pending.filter((f) => !f.parentId || !pending.some((p) => p.id === f.parentId));
    if (!ready.length) break;
    await tx.folder.createMany({ data: ready.map((f) => ({ id: folderMap.get(f.id)!, projectId: targetId, parentId: f.parentId ? (folderMap.get(f.parentId) ?? null) : null, name: f.name })) });
    for (const f of ready) pending.splice(pending.indexOf(f), 1);
  }
  return { tasks: tasks.length };
}

async function requireProjectTemplate(templateId: string) {
  const t = await prisma.project.findFirst({ where: { id: templateId, isTemplate: true }, select: { id: true, name: true } });
  if (!t) throw notFound("Projet type");
  return t;
}

/** Applique un projet type à un projet vide (propriétaire, ou administrateur pour un modèle). */
export async function applyProjectTemplate(userId: string, projectId: string, templateId: string): Promise<ProjectDto> {
  const access = await requireProjectAccess(userId, projectId);
  if (!access.isOwner) throw new ApiError(403, "FORBIDDEN", "Seul le propriétaire du projet peut l'initialiser à partir d'un modèle.");
  const template = await requireProjectTemplate(templateId);
  if (template.id === projectId) throw badRequest("Un modèle ne peut pas s'appliquer à lui-même.");
  return mutateProject(projectId, async (tx) => {
    if (!(await projectIsEmpty(tx, projectId))) throw new ApiError(409, "NOT_EMPTY", "Le projet n'est pas vide : un modèle ne s'applique qu'à un projet sans étapes, tâches, livrables, risques ni dossiers.");
    await copyProjectStructure(tx, userId, template.id, projectId, template.name);
  });
}

/** Nouveau projet type (vierge, ou copie de la structure d'un projet / modèle existant). */
export async function createProjectTemplate(admin: Pick<User, "id" | "email" | "role">, input: { name: string; fromProjectId?: string | null }): Promise<ProjectDto> {
  requireAdmin(admin);
  if (input.fromProjectId) await getProject(admin.id, input.fromProjectId); // accès vérifié (404 sinon)
  const id = newId("c");
  await prisma.$transaction(
    async (tx) => {
      await tx.project.create({ data: { id, ownerId: admin.id, name: input.name.trim(), isTemplate: true } });
      if (input.fromProjectId) await copyProjectStructure(tx, admin.id, input.fromProjectId, id, input.name.trim());
    },
    { timeout: 60_000 },
  );
  return getProject(admin.id, id);
}

// --- Cartes types ------------------------------------------------------------------------------

async function requireMapTemplate(templateId: string) {
  const t = await prisma.mindMap.findFirst({ where: { id: templateId, isTemplate: true }, select: { id: true, title: true } });
  if (!t) throw notFound("Carte type");
  return t;
}

/** Copie les nœuds de `sourceId` sous la racine de `targetId`. */
async function copyMapStructure(tx: Tx, sourceId: string, targetId: string): Promise<number> {
  const [nodes, targetRoot] = await Promise.all([
    tx.mindNode.findMany({ where: { mapId: sourceId } }),
    tx.mindNode.findFirst({ where: { mapId: targetId, parentId: null } }),
  ]);
  if (!targetRoot) throw notFound("Racine de la carte");
  const sourceRoot = nodes.find((n) => !n.parentId);
  if (!sourceRoot) return 0;
  const idMap = new Map<string, string>([[sourceRoot.id, targetRoot.id]]);
  for (const n of nodes) if (n.id !== sourceRoot.id) idMap.set(n.id, newId("c"));
  await tx.mindNode.update({
    where: { id: targetRoot.id },
    data: {
      ...(!targetRoot.notes.trim() && sourceRoot.notes ? { notes: sourceRoot.notes } : {}),
      ...(!targetRoot.color && sourceRoot.color ? { color: sourceRoot.color } : {}),
    },
  });
  // Parents d'abord (clé étrangère parentId).
  const children = new Map<string, typeof nodes>();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  let level = children.get(sourceRoot.id) ?? [];
  let count = 0;
  while (level.length) {
    await tx.mindNode.createMany({
      data: level.map((n) => ({ id: idMap.get(n.id)!, mapId: targetId, parentId: idMap.get(n.parentId!)!, title: n.title, notes: n.notes, color: n.color, status: n.status, order: n.order, collapsed: n.collapsed, x: n.x, y: n.y })),
    });
    count += level.length;
    level = level.flatMap((n) => children.get(n.id) ?? []);
  }
  return count;
}

/** Applique une carte type à une carte qui n'a que sa racine (droit d'écriture). */
export async function applyMapTemplate(userId: string, mapId: string, templateId: string): Promise<MindMapDto> {
  await requireMapAccess(userId, mapId, "write");
  const template = await requireMapTemplate(templateId);
  if (template.id === mapId) throw badRequest("Un modèle ne peut pas s'appliquer à lui-même.");
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MindMap" WHERE "id" = ${mapId} FOR UPDATE`;
      if ((await tx.mindNode.count({ where: { mapId } })) > 1) throw new ApiError(409, "NOT_EMPTY", "La carte n'est pas vide : un modèle ne s'applique qu'à une carte qui n'a que sa racine.");
      const n = await copyMapStructure(tx, template.id, mapId);
      await tx.mindMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
      const actor = await actorDisplayName(tx, userId);
      await recordMapEvents(tx, [{ mapId, actorId: userId, actorName: actor, kind: "created", newValue: template.title, message: `${actor} a appliqué la carte type « ${template.title} » (${n} nœud${n > 1 ? "s" : ""})` }]);
    },
    { timeout: 60_000 },
  );
  return getMindMap(userId, mapId);
}

/** Nouvelle carte type (vierge, ou copie d'une carte / d'un modèle existant). */
export async function createMapTemplate(admin: Pick<User, "id" | "email" | "role">, input: { title: string; fromMapId?: string | null }): Promise<MindMapDto> {
  requireAdmin(admin);
  if (input.fromMapId) await requireMapAccess(admin.id, input.fromMapId, "read");
  const id = newId("c");
  await prisma.$transaction(
    async (tx) => {
      await tx.mindMap.create({ data: { id, ownerId: admin.id, title: input.title.trim(), isTemplate: true, nodes: { create: { title: input.title.trim(), order: 0 } } } });
      if (input.fromMapId) await copyMapStructure(tx, input.fromMapId, id);
    },
    { timeout: 60_000 },
  );
  return getMindMap(admin.id, id);
}
