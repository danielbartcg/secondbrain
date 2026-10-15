import "server-only";
import type { DeliverableStatus, Prisma, ProjectStatus, TaskComplexity, TaskPriority, TaskStatus, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { sanitizeNotes } from "@/lib/sanitize";
import { deleteProjectDocumentsDir } from "@/lib/uploads";
import { requireAdmin } from "@/lib/users";
import { prerequisiteError } from "@/lib/shared/prerequisites";
import {
  DOCUMENT_INCLUDE,
  MEMBER_INCLUDE,
  PROJECT_INCLUDE,
  TASK_INCLUDE,
  aggregate,
  hasHtmlContent,
  isMyTask,
  iso,
  reconcile,
  toDocumentDto,
  toMemberDto,
  toProjectDto,
  toTaskDto,
  type ProjectDto,
  type ProjectSummary,
  type TaskDto,
} from "@/lib/shared/project-model";
export * from "@/lib/shared/project-model";
import type {
  CreateActivityInput,
  CreateDeliverableInput,
  CreateFolderInput,
  UpdateFolderInput,
  CreateMemberInput,
  CreateProjectInput,
  CreateStageInput,
  CreateTaskInput,
  UpdateActivityInput,
  UpdateDeliverableInput,
  UpdateMemberInput,
  UpdateProjectInput,
  UpdateStageInput,
  UpdateTaskInput,
} from "@/lib/schemas";

/**
 * Logique métier de la gestion de projet :
 *   Projet > Étape > (Activité facultative) > Tâche
 *   + équipe projet (membres), livrables, documents.
 *
 * Accès : le propriétaire ET les membres rattachés à un compte (`userId`)
 * voient et modifient le projet ; seul le propriétaire le supprime ou gère
 * l'équipe. L'avancement n'est saisi QUE sur les tâches ; les niveaux
 * supérieurs l'agrègent.
 *
 * Toute mutation s'exécute dans une transaction qui verrouille d'abord la
 * ligne du projet : les mutations concurrentes s'enchaînent sans interblocage.
 */

type Tx = Prisma.TransactionClient;

const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);


// --- Accès et verrouillage ---------------------------------------------------

/** Projets visibles : les miens + ceux dont je suis membre (compte rattaché). */
export function projectAccessWhere(userId: string): Prisma.ProjectWhereInput {
  return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}

export type ProjectAccess = { id: string; ownerId: string; isOwner: boolean };

/** Vérifie l'accès (propriétaire ou membre) ; lève 404 sinon. */
export async function requireProjectAccess(userId: string, projectId: string): Promise<ProjectAccess> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, ...projectAccessWhere(userId) },
    select: { id: true, ownerId: true },
  });
  if (!p) throw notFound("Projet");
  return { id: p.id, ownerId: p.ownerId, isOwner: p.ownerId === userId };
}

/** Réservé au propriétaire (suppression, équipe). */
export async function requireProjectOwner(userId: string, projectId: string): Promise<ProjectAccess> {
  const access = await requireProjectAccess(userId, projectId);
  if (!access.isOwner) throw forbidden();
  return access;
}

export async function stageProjectId(userId: string, stageId: string): Promise<string> {
  const s = await prisma.stage.findFirst({ where: { id: stageId, project: projectAccessWhere(userId) }, select: { projectId: true } });
  if (!s) throw notFound("Étape");
  return s.projectId;
}

export async function activityProjectId(userId: string, activityId: string): Promise<string> {
  const a = await prisma.activity.findFirst({
    where: { id: activityId, stage: { project: projectAccessWhere(userId) } },
    select: { stage: { select: { projectId: true } } },
  });
  if (!a) throw notFound("Activité");
  return a.stage.projectId;
}

export async function memberProjectId(userId: string, memberId: string): Promise<string> {
  const m = await prisma.projectMember.findFirst({ where: { id: memberId, project: projectAccessWhere(userId) }, select: { projectId: true } });
  if (!m) throw notFound("Membre");
  return m.projectId;
}

export async function deliverableProjectId(userId: string, deliverableId: string): Promise<string> {
  const d = await prisma.deliverable.findFirst({ where: { id: deliverableId, project: projectAccessWhere(userId) }, select: { projectId: true } });
  if (!d) throw notFound("Livrable");
  return d.projectId;
}

/** Transaction sérialisée sur le projet (verrou de ligne), puis projet recalculé. */
export async function mutateProject(projectId: string, fn: (tx: Tx) => Promise<void>): Promise<ProjectDto> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      await fn(tx);
      const p = await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() }, include: PROJECT_INCLUDE });
      return toProjectDto(p);
    },
    { timeout: 15_000 },
  );
}

/** Renumérote des frères ; `moveId` inséré à `index` si fourni. */
async function resequence(
  tx: Tx,
  model: "stage" | "activity" | "task" | "deliverable",
  where: Record<string, unknown>,
  moveId?: string,
  index?: number,
) {
  const delegate = tx[model] as unknown as {
    findMany: (args: unknown) => Promise<Array<{ id: string; order: number }>>;
    update: (args: unknown) => Promise<unknown>;
  };
  const rows = await delegate.findMany({
    where: { ...where, ...(moveId ? { NOT: { id: moveId } } : {}) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, order: true },
  });
  const ids = rows.map((r) => r.id);
  if (moveId) {
    const at = index === undefined ? ids.length : Math.min(index, ids.length);
    ids.splice(at, 0, moveId);
  }
  const current = new Map(rows.map((r) => [r.id, r.order]));
  for (let order = 0; order < ids.length; order++) {
    if (current.get(ids[order]) === order) continue;
    await delegate.update({ where: { id: ids[order] }, data: { order } });
  }
}

/** Sélection des personnes d'une tâche (pour `isMyTask`). */
export const TASK_PEOPLE_SELECT = {
  assignee: { select: { name: true, userId: true } },
  supervisor: { select: { name: true, userId: true } },
  contributors: { select: { memberId: true, member: { select: { userId: true } } } },
} satisfies Prisma.TaskInclude;

/** Vérifie que des membres appartiennent au projet ; renvoie les ids dédoublonnés. */
async function checkMembers(tx: Tx, projectId: string | null, memberIds: string[] | undefined): Promise<string[] | undefined> {
  if (memberIds === undefined) return undefined;
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return [];
  if (!projectId) throw badRequest("Une tâche sans projet ne peut pas avoir de contributeurs.");
  const found = await tx.projectMember.count({ where: { id: { in: ids }, projectId } });
  if (found !== ids.length) throw badRequest("Un des membres n'appartient pas au projet.");
  return ids;
}

/** Notifications « vous a ajouté » pour les membres (à compte) nouvellement impliqués. */
async function notifyInvolved(tx: Tx, actorId: string, taskId: string, taskName: string, projectId: string | null, involved: Array<{ memberId: string; role: string }>) {
  if (involved.length === 0) return;
  const members = await tx.projectMember.findMany({ where: { id: { in: involved.map((i) => i.memberId) } }, select: { id: true, userId: true } });
  const name = await actorName(tx, actorId);
  await notify(
    tx,
    involved.map((i) => ({
      userId: members.find((m) => m.id === i.memberId)?.userId,
      actorId,
      actorName: name,
      type: "ASSIGNED" as const,
      title: `${name} vous a ajouté comme ${i.role} sur « ${taskName} »`,
      href: taskHref(taskId),
      taskId,
      projectId,
    })),
  );
}

export const taskHref = (taskId: string) => `/tasks/${taskId}`;

/** Membre + compte rattaché (pour notifier). */
async function memberUser(tx: Tx, memberId: string | null | undefined): Promise<{ userId: string | null } | null> {
  if (!memberId) return null;
  return tx.projectMember.findUnique({ where: { id: memberId }, select: { userId: true } });
}

async function actorName(tx: Tx, userId: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? "Quelqu'un";
}

/** Un membre affecté doit appartenir au projet. */
async function checkMember(tx: Tx, projectId: string, memberId: string | null | undefined) {
  if (!memberId) return;
  const m = await tx.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true } });
  if (!m) throw badRequest("Ce membre n'appartient pas au projet.");
}

// --- Projets -----------------------------------------------------------------

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await prisma.project.findMany({ where: projectAccessWhere(userId), orderBy: { updatedAt: "desc" }, include: PROJECT_INCLUDE });
  return rows.map((p) => {
    const { stages: _s, tasks: _t, members: _m, deliverables: _d, documents: _doc, folders: _f, notes: _n, ...summary } = toProjectDto(p);
    void _s;
    void _n;
    void _t;
    void _m;
    void _d;
    void _doc;
    void _f;
    return summary;
  });
}

// --- Administration (lecture seule) ---------------------------------------------

export type AdminProjectSummary = ProjectSummary & { ownerName: string; ownerEmail: string; taskCount: number };

/** Tous les projets (administration ; lecture seule, rôle vérifié ici). */
export async function listAllProjectsAdmin(admin: Pick<User, "email" | "role">): Promise<AdminProjectSummary[]> {
  requireAdmin(admin);
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: "desc" }, include: { ...PROJECT_INCLUDE, owner: { select: { name: true, email: true } } } });
  return rows.map((p) => {
    const { stages: _s, tasks: _t, members: _m, deliverables: _d, documents: _doc, folders: _f, notes: _n, ...summary } = toProjectDto(p);
    void _s;
    void _t;
    void _m;
    void _d;
    void _doc;
    void _f;
    void _n;
    return { ...summary, ownerName: p.owner.name, ownerEmail: p.owner.email, taskCount: summary.progress.total };
  });
}

/** Un projet quelconque (administration, lecture seule). */
export async function getProjectAdmin(admin: Pick<User, "email" | "role">, projectId: string): Promise<ProjectDto & { ownerName: string }> {
  requireAdmin(admin);
  const p = await prisma.project.findUnique({ where: { id: projectId }, include: { ...PROJECT_INCLUDE, owner: { select: { name: true } } } });
  if (!p) throw notFound("Projet");
  return { ...toProjectDto(p), ownerName: p.owner.name };
}

export async function getProject(userId: string, projectId: string): Promise<ProjectDto> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, include: PROJECT_INCLUDE });
  if (!p) throw notFound("Projet");
  return toProjectDto(p);
}

export async function createProject(userId: string, input: CreateProjectInput, id?: string): Promise<ProjectDto> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  const p = await prisma.project.create({
    data: {
      id,
      ownerId: userId,
      name: input.name,
      description: input.description,
      color: input.color ?? null,
      status: input.status ?? "ACTIVE",
      startDate: toDate(input.startDate) ?? null,
      dueDate: toDate(input.dueDate) ?? null,
      // Le créateur fait d'office partie de l'équipe : il peut s'affecter des tâches.
      members: { create: { userId, name: owner.name, email: owner.email, role: "Chef de projet" } },
    },
  });
  return getProject(userId, p.id);
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description,
        color: input.color,
        status: input.status,
        startDate: toDate(input.startDate),
        dueDate: toDate(input.dueDate),
      },
    });
  });
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  await requireProjectOwner(userId, projectId);
  await prisma.project.delete({ where: { id: projectId } });
  // Fichiers des documents : hors transaction, au mieux (la base fait foi).
  await deleteProjectDocumentsDir(projectId).catch((e) => console.error("[projects] suppression des documents", e));
}

// --- Équipe ------------------------------------------------------------------

export async function addMember(userId: string, projectId: string, input: CreateMemberInput): Promise<ProjectDto> {
  await requireProjectOwner(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    if (input.userId) {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, email: true } });
      if (!user) throw notFound("Utilisateur");
      const existing = await tx.projectMember.findFirst({ where: { projectId, userId: user.id } });
      if (existing) throw badRequest("Cette personne fait déjà partie de l'équipe.");
      await tx.projectMember.create({
        data: { projectId, userId: user.id, name: input.name ?? user.name, email: user.email, role: input.role ?? null, color: input.color ?? null },
      });
    } else {
      await tx.projectMember.create({
        data: { projectId, name: input.name!, email: input.email ?? null, role: input.role ?? null, color: input.color ?? null },
      });
    }
  });
}

export async function updateMember(userId: string, memberId: string, input: UpdateMemberInput): Promise<ProjectDto> {
  const projectId = await memberProjectId(userId, memberId);
  await requireProjectOwner(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    await tx.projectMember.update({ where: { id: memberId }, data: { name: input.name, email: input.email, role: input.role, color: input.color } });
  });
}

export async function removeMember(userId: string, memberId: string): Promise<ProjectDto> {
  const projectId = await memberProjectId(userId, memberId);
  await requireProjectOwner(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    const m = await tx.projectMember.findUniqueOrThrow({ where: { id: memberId }, select: { userId: true, project: { select: { ownerId: true } } } });
    if (m.userId && m.userId === m.project.ownerId) throw badRequest("Le propriétaire du projet ne peut pas être retiré de l'équipe.");
    await tx.projectMember.delete({ where: { id: memberId } });
  });
}

/** Recherche d'un compte de l'application par e-mail exact (pour l'inviter). */
export async function lookupUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, name: true, email: true } });
}

// --- Étapes ------------------------------------------------------------------

export async function createStage(userId: string, projectId: string, input: CreateStageInput, id?: string): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.stage.count({ where: { projectId } });
    await tx.stage.create({
      data: {
        id,
        projectId,
        name: input.name,
        description: input.description,
        order: count,
        startDate: toDate(input.startDate) ?? null,
        dueDate: toDate(input.dueDate) ?? null,
      },
    });
  });
}

export async function updateStage(userId: string, stageId: string, input: UpdateStageInput): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: { name: input.name, description: input.description, startDate: toDate(input.startDate), dueDate: toDate(input.dueDate) },
    });
    if (input.order !== undefined) await resequence(tx, "stage", { projectId }, stageId, input.order);
  });
}

export async function deleteStage(userId: string, stageId: string): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    await tx.stage.delete({ where: { id: stageId } });
    await resequence(tx, "stage", { projectId });
  });
}

// --- Activités ---------------------------------------------------------------

export async function createActivity(userId: string, stageId: string, input: CreateActivityInput, id?: string): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.activity.count({ where: { stageId } });
    await tx.activity.create({ data: { id, stageId, name: input.name, description: input.description, order: count } });
  });
}

export async function updateActivity(userId: string, activityId: string, input: UpdateActivityInput): Promise<ProjectDto> {
  const projectId = await activityProjectId(userId, activityId);
  return mutateProject(projectId, async (tx) => {
    const a = await tx.activity.update({ where: { id: activityId }, data: { name: input.name, description: input.description } });
    if (input.order !== undefined) await resequence(tx, "activity", { stageId: a.stageId }, activityId, input.order);
  });
}

export async function deleteActivity(userId: string, activityId: string): Promise<ProjectDto> {
  const projectId = await activityProjectId(userId, activityId);
  return mutateProject(projectId, async (tx) => {
    const a = await tx.activity.delete({ where: { id: activityId } });
    await resequence(tx, "activity", { stageId: a.stageId });
  });
}

// --- Tâches ------------------------------------------------------------------

/** Tâches visibles : celles de mes projets (propriétaire ou membre) + mes tâches sans projet. */
export function taskAccessWhere(userId: string): Prisma.TaskWhereInput {
  return { OR: [{ project: projectAccessWhere(userId) }, { projectId: null, ownerId: userId }] };
}

export type TaskMutation = { project: ProjectDto | null; task: TaskDto | null };

/** Rattachement résolu et cohérent : activité ⇒ étape ⇒ projet. */
type Attachment = { projectId: string | null; stageId: string | null; activityId: string | null };

/**
 * Résout un rattachement demandé (activityId / stageId / projectId) en
 * vérifiant l'accès à chaque niveau. Le niveau le plus précis l'emporte.
 */
async function resolveAttachment(
  userId: string,
  target: { projectId?: string | null; stageId?: string | null; activityId?: string | null },
): Promise<Attachment> {
  if (target.activityId) {
    const a = await prisma.activity.findFirst({
      where: { id: target.activityId, stage: { project: projectAccessWhere(userId) } },
      select: { id: true, stageId: true, stage: { select: { projectId: true } } },
    });
    if (!a) throw notFound("Activité");
    return { projectId: a.stage.projectId, stageId: a.stageId, activityId: a.id };
  }
  if (target.stageId) {
    const s = await prisma.stage.findFirst({ where: { id: target.stageId, project: projectAccessWhere(userId) }, select: { id: true, projectId: true } });
    if (!s) throw notFound("Étape");
    return { projectId: s.projectId, stageId: s.id, activityId: null };
  }
  if (target.projectId) {
    await requireProjectAccess(userId, target.projectId);
    return { projectId: target.projectId, stageId: null, activityId: null };
  }
  return { projectId: null, stageId: null, activityId: null };
}

/** Groupe de frères d'une tâche pour la renumérotation (`order`). */
function siblingWhere(t: Attachment & { ownerId: string }): Record<string, unknown> {
  if (t.stageId) return { stageId: t.stageId, activityId: t.activityId };
  if (t.projectId) return { projectId: t.projectId, stageId: null };
  return { ownerId: t.ownerId, projectId: null };
}

/** Un nœud de carte référencé doit appartenir à l'utilisateur. */
export async function checkNode(db: Tx | typeof prisma, userId: string, nodeId: string | null | undefined) {
  if (!nodeId) return;
  const n = await db.mindNode.findFirst({ where: { id: nodeId, map: { ownerId: userId } }, select: { id: true } });
  if (!n) throw notFound("Nœud");
}

/**
 * Transaction d'une mutation de tâche : verrouille la ligne du projet concerné
 * (s'il y en a un) et renvoie le projet recalculé (ou null pour une tâche sans
 * projet) ainsi que la tâche.
 */
async function mutateTask(projectId: string | null, fn: (tx: Tx) => Promise<string | null>): Promise<TaskMutation> {
  return prisma.$transaction(
    async (tx) => {
      if (projectId) await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const taskId = await fn(tx);
      let project: ProjectDto | null = null;
      if (projectId) {
        const p = await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() }, include: PROJECT_INCLUDE });
        project = toProjectDto(p);
      }
      const task = taskId ? await tx.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE }) : null;
      return { project, task: task ? toTaskDto(task) : null };
    },
    { timeout: 15_000 },
  );
}

export async function accessibleTask(userId: string, taskId: string) {
  const t = await prisma.task.findFirst({ where: { id: taskId, ...taskAccessWhere(userId) } });
  if (!t) throw notFound("Tâche");
  return t;
}

/** Mes tâches sans projet (visibles dans le projet virtuel « Sans projet »). */
export async function listOrphanTasks(userId: string): Promise<TaskDto[]> {
  const rows = await prisma.task.findMany({ where: { ownerId: userId, projectId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: TASK_INCLUDE });
  return rows.map(toTaskDto);
}

/** Valide une liste de prérequis (même projet, pas soi-même, pas de cycle) ; renvoie la liste dédoublonnée. */
async function checkPrerequisites(tx: Tx, taskId: string, projectId: string | null, ids: string[] | undefined): Promise<string[] | undefined> {
  if (ids === undefined) return undefined;
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  if (!projectId) throw badRequest("Une tâche sans projet ne peut pas avoir de prérequis.");
  const tasks = await tx.task.findMany({ where: { projectId }, select: { id: true, prerequisiteIds: true } });
  const error = prerequisiteError(taskId, unique, tasks);
  if (error) throw badRequest(error);
  return unique;
}

/** Retire une tâche des listes de prérequis des autres tâches (suppression, changement de projet). */
async function dropFromPrerequisites(tx: Tx, taskId: string) {
  await tx.$executeRaw`UPDATE "Task" SET "prerequisiteIds" = array_remove("prerequisiteIds", ${taskId}) WHERE ${taskId} = ANY("prerequisiteIds")`;
}

export async function createTask(
  userId: string,
  target: { projectId?: string | null; stageId?: string | null; activityId?: string | null; nodeId?: string | null },
  input: CreateTaskInput,
  id?: string,
): Promise<TaskMutation> {
  const att = await resolveAttachment(userId, target);
  await checkNode(prisma, userId, target.nodeId);
  return mutateTask(att.projectId, async (tx) => {
    if (input.assigneeId || input.supervisorId) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      await checkMember(tx, att.projectId, input.assigneeId);
      await checkMember(tx, att.projectId, input.supervisorId);
    }
    const contributorIds = (await checkMembers(tx, att.projectId, input.contributorIds)) ?? [];
    // Nouvelle tâche : aucune autre ne dépend encore d'elle, pas de cycle possible.
    const prerequisiteIds = (await checkPrerequisites(tx, id ?? "__nouvelle__", att.projectId, input.prerequisiteIds)) ?? [];
    const { status, progress } = reconcile({ status: "TODO", progress: 0 }, input);
    const count = await tx.task.count({ where: siblingWhere({ ...att, ownerId: userId }) });
    const created = await tx.task.create({
      data: {
        id,
        ownerId: userId,
        projectId: att.projectId,
        stageId: att.stageId,
        activityId: att.activityId,
        assigneeId: input.assigneeId ?? null,
        supervisorId: input.supervisorId ?? null,
        ...(contributorIds.length ? { contributors: { create: contributorIds.map((memberId) => ({ memberId })) } } : {}),
        name: input.name,
        description: input.description,
        status,
        progress,
        priority: input.priority ?? "MEDIUM",
        complexity: input.complexity ?? "MEDIUM",
        order: count,
        startDate: toDate(input.startDate) ?? null,
        dueDate: toDate(input.dueDate) ?? null,
        closedAt: status === "CLOSED" ? new Date() : null,
        prerequisiteIds,
        ...(target.nodeId ? { nodes: { create: { nodeId: target.nodeId } } } : {}),
      },
    });
    const assignee = await memberUser(tx, input.assigneeId);
    if (assignee?.userId) {
      const name = await actorName(tx, userId);
      await notify(tx, [
        { userId: assignee.userId, actorId: userId, actorName: name, type: "ASSIGNED", title: `${name} vous a assigné la tâche « ${created.name} »`, href: taskHref(created.id), taskId: created.id, projectId: att.projectId },
      ]);
    }
    await notifyInvolved(tx, userId, created.id, created.name, att.projectId, [
      ...(input.supervisorId ? [{ memberId: input.supervisorId, role: "superviseur" }] : []),
      ...contributorIds.map((memberId) => ({ memberId, role: "contributeur" })),
    ]);
    return created.id;
  });
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<TaskMutation> {
  const t = await accessibleTask(userId, taskId);

  // Nouveau rattachement éventuel (le niveau le plus précis l'emporte ; `null` détache).
  let att: Attachment = { projectId: t.projectId, stageId: t.stageId, activityId: t.activityId };
  if (input.activityId) att = await resolveAttachment(userId, { activityId: input.activityId });
  else if (input.stageId) {
    att = await resolveAttachment(userId, { stageId: input.stageId });
    if (att.stageId === t.stageId && input.activityId === undefined) att.activityId = t.activityId;
  } else if (input.activityId === null && input.stageId === undefined && input.projectId === undefined) {
    att = { ...att, activityId: null };
  } else if (input.stageId === null && input.projectId === undefined) {
    att = { projectId: t.projectId, stageId: null, activityId: null };
  } else if (input.projectId !== undefined) {
    att = await resolveAttachment(userId, { projectId: input.projectId });
    if (att.projectId === t.projectId) att = { projectId: t.projectId, stageId: t.stageId, activityId: t.activityId };
  }
  // Sortir une tâche de son projet (« sans projet ») : réservé à son créateur ou au propriétaire du projet.
  if (t.projectId && att.projectId === null && t.ownerId !== userId) {
    const project = await prisma.project.findUnique({ where: { id: t.projectId }, select: { ownerId: true } });
    if (project?.ownerId !== userId) {
      throw new ApiError(403, "FORBIDDEN", "Seul le créateur de la tâche ou le propriétaire du projet peut la détacher du projet.");
    }
  }
  const moved = att.projectId !== t.projectId || att.stageId !== t.stageId || att.activityId !== t.activityId;
  const projectChanged = att.projectId !== t.projectId;

  return mutateTask(att.projectId, async (tx) => {
    const { status, progress } = reconcile(t, input);

    // Date de clôture : automatique à la clôture, effacée à la réouverture,
    // modifiable seulement tant que la tâche est clôturée.
    let closedAt: Date | null | undefined = undefined;
    if (status === "CLOSED" && t.status !== "CLOSED") closedAt = new Date();
    if (status !== "CLOSED" && t.status === "CLOSED") closedAt = null;
    if (input.closedAt !== undefined) {
      if (status !== "CLOSED") {
        if (input.closedAt !== null) throw badRequest("La date de clôture n'est modifiable que sur une tâche clôturée.");
      } else {
        if (input.closedAt === null) throw badRequest("Une tâche clôturée garde une date de clôture.");
        closedAt = toDate(input.closedAt);
      }
    }
    // Changement de projet : l'affectation (membre de l'ancien projet) tombe, sauf nouvelle affectation valide.
    let assigneeId = input.assigneeId;
    let supervisorId = input.supervisorId;
    let contributorIds = input.contributorIds;
    let prerequisiteInput = input.prerequisiteIds;
    if (projectChanged) {
      if (assigneeId === undefined) assigneeId = null;
      if (supervisorId === undefined) supervisorId = null;
      if (contributorIds === undefined) contributorIds = [];
      // Les dépendances ne traversent pas les projets.
      if (prerequisiteInput === undefined) prerequisiteInput = [];
      await dropFromPrerequisites(tx, taskId);
    }
    const prerequisiteIds = await checkPrerequisites(tx, taskId, att.projectId, prerequisiteInput);
    if (assigneeId || supervisorId) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      await checkMember(tx, att.projectId, assigneeId);
      await checkMember(tx, att.projectId, supervisorId);
    }
    const newContributors = await checkMembers(tx, att.projectId, contributorIds);
    const previousContributors = (await tx.taskContributor.findMany({ where: { taskId }, select: { memberId: true } })).map((c) => c.memberId);
    if (newContributors !== undefined) {
      await tx.taskContributor.deleteMany({ where: { taskId, memberId: { notIn: newContributors } } });
      const toAdd = newContributors.filter((id) => !previousContributors.includes(id));
      if (toAdd.length) await tx.taskContributor.createMany({ data: toAdd.map((memberId) => ({ taskId, memberId })) });
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        name: input.name,
        description: input.description,
        status,
        progress,
        priority: input.priority,
        complexity: input.complexity,
        assigneeId,
        supervisorId,
        startDate: toDate(input.startDate),
        dueDate: toDate(input.dueDate),
        closedAt,
        prerequisiteIds,
        projectId: att.projectId,
        stageId: att.stageId,
        activityId: att.activityId,
        ...(moved ? { order: 1_000_000 } : {}),
      },
    });
    if (moved || input.order !== undefined) {
      await resequence(tx, "task", siblingWhere({ ...att, ownerId: t.ownerId }), taskId, input.order);
      if (moved) await resequence(tx, "task", siblingWhere({ projectId: t.projectId, stageId: t.stageId, activityId: t.activityId, ownerId: t.ownerId }));
    }

    // Notifications : nouvelle affectation, ou mise à jour d'une tâche affectée à quelqu'un d'autre.
    const changes: string[] = [];
    if (input.name !== undefined && input.name !== t.name) changes.push("nom");
    if (input.description !== undefined && input.description !== t.description) changes.push("description");
    if (status !== t.status) changes.push("statut");
    else if (progress !== t.progress) changes.push("avancement");
    if (input.priority !== undefined && input.priority !== t.priority) changes.push("priorité");
    if (input.complexity !== undefined && input.complexity !== t.complexity) changes.push("complexité");
    if (input.startDate !== undefined && iso(toDate(input.startDate)) !== iso(t.startDate)) changes.push("date de début");
    if (input.dueDate !== undefined && iso(toDate(input.dueDate)) !== iso(t.dueDate)) changes.push("échéance");
    if (input.closedAt !== undefined && status === "CLOSED" && t.status === "CLOSED" && iso(toDate(input.closedAt)) !== iso(t.closedAt)) changes.push("date de clôture");
    if (moved) changes.push("rattachement");
    if (prerequisiteIds !== undefined && [...prerequisiteIds].sort().join() !== [...(t.prerequisiteIds ?? [])].sort().join()) changes.push("prérequis");
    const supervisorChanged = updated.supervisorId !== t.supervisorId;
    if (supervisorChanged) changes.push("superviseur");
    const addedContributors = newContributors ? newContributors.filter((id) => !previousContributors.includes(id)) : [];
    if (newContributors && (addedContributors.length || newContributors.length !== previousContributors.length)) changes.push("contributeurs");
    await notifyInvolved(tx, userId, taskId, updated.name, att.projectId, [
      ...(supervisorChanged && updated.supervisorId ? [{ memberId: updated.supervisorId, role: "superviseur" }] : []),
      ...addedContributors.map((memberId) => ({ memberId, role: "contributeur" })),
    ]);
    const assigneeChanged = updated.assigneeId !== t.assigneeId;
    const assignee = await memberUser(tx, updated.assigneeId);
    if (assignee?.userId && assignee.userId !== userId && (assigneeChanged || changes.length > 0)) {
      const name = await actorName(tx, userId);
      const href = taskHref(taskId);
      await notify(tx, [
        assigneeChanged
          ? { userId: assignee.userId, actorId: userId, actorName: name, type: "ASSIGNED", title: `${name} vous a assigné la tâche « ${updated.name} »`, href, taskId, projectId: att.projectId }
          : { userId: assignee.userId, actorId: userId, actorName: name, type: "TASK_UPDATED", title: `${name} a mis à jour « ${updated.name} »`, body: `Modifié : ${changes.join(", ")}.`, href, taskId, projectId: att.projectId },
      ]);
    }
    return taskId;
  });
}

export async function deleteTask(userId: string, taskId: string): Promise<TaskMutation> {
  const t = await accessibleTask(userId, taskId);
  return mutateTask(t.projectId, async (tx) => {
    await dropFromPrerequisites(tx, taskId);
    await tx.task.delete({ where: { id: taskId } });
    await resequence(tx, "task", siblingWhere({ projectId: t.projectId, stageId: t.stageId, activityId: t.activityId, ownerId: t.ownerId }));
    return null;
  });
}

// --- Livrables ---------------------------------------------------------------

async function checkStage(tx: Tx, projectId: string, stageId: string | null | undefined) {
  if (!stageId) return;
  const s = await tx.stage.findFirst({ where: { id: stageId, projectId }, select: { id: true } });
  if (!s) throw badRequest("Cette étape n'appartient pas au projet.");
}

export async function createDeliverable(userId: string, projectId: string, input: CreateDeliverableInput): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    await checkStage(tx, projectId, input.stageId);
    await checkMember(tx, projectId, input.assigneeId);
    const count = await tx.deliverable.count({ where: { projectId } });
    await tx.deliverable.create({
      data: {
        projectId,
        stageId: input.stageId ?? null,
        assigneeId: input.assigneeId ?? null,
        name: input.name,
        description: input.description,
        status: input.status ?? "PLANNED",
        expectedStart: toDate(input.expectedStart) ?? null,
        expectedEnd: toDate(input.expectedEnd) ?? null,
        deliveredAt: toDate(input.deliveredAt) ?? null,
        order: count,
      },
    });
  });
}

export async function updateDeliverable(userId: string, deliverableId: string, input: UpdateDeliverableInput): Promise<ProjectDto> {
  const projectId = await deliverableProjectId(userId, deliverableId);
  return mutateProject(projectId, async (tx) => {
    await checkStage(tx, projectId, input.stageId);
    await checkMember(tx, projectId, input.assigneeId);
    const current = await tx.deliverable.findUniqueOrThrow({ where: { id: deliverableId } });
    // Passage à « livré / validé » sans date : on horodate ; retour en arrière : on efface.
    let deliveredAt = toDate(input.deliveredAt);
    if (input.status && deliveredAt === undefined) {
      if ((input.status === "DELIVERED" || input.status === "VALIDATED") && !current.deliveredAt) deliveredAt = new Date();
      if (input.status === "PLANNED" || input.status === "IN_PROGRESS") deliveredAt = null;
    }
    await tx.deliverable.update({
      where: { id: deliverableId },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        stageId: input.stageId,
        assigneeId: input.assigneeId,
        expectedStart: toDate(input.expectedStart),
        expectedEnd: toDate(input.expectedEnd),
        deliveredAt,
      },
    });
    if (input.order !== undefined) await resequence(tx, "deliverable", { projectId }, deliverableId, input.order);
  });
}

export async function deleteDeliverable(userId: string, deliverableId: string): Promise<ProjectDto> {
  const projectId = await deliverableProjectId(userId, deliverableId);
  return mutateProject(projectId, async (tx) => {
    await tx.deliverable.delete({ where: { id: deliverableId } });
    await resequence(tx, "deliverable", { projectId });
  });
}

// --- Dossiers documentaires --------------------------------------------------

export async function folderProjectId(userId: string, folderId: string): Promise<string> {
  const f = await prisma.folder.findFirst({ where: { id: folderId, project: projectAccessWhere(userId) }, select: { projectId: true } });
  if (!f) throw notFound("Dossier");
  return f.projectId;
}

/** Un dossier référencé doit appartenir au projet. */
export async function checkFolder(tx: Tx, projectId: string, folderId: string | null | undefined) {
  if (!folderId) return;
  const f = await tx.folder.findFirst({ where: { id: folderId, projectId }, select: { id: true } });
  if (!f) throw badRequest("Ce dossier n'appartient pas au projet.");
}

export async function createFolder(userId: string, projectId: string, input: CreateFolderInput): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    await checkFolder(tx, projectId, input.parentId);
    await tx.folder.create({ data: { projectId, parentId: input.parentId ?? null, name: input.name } });
  });
}

export async function updateFolder(userId: string, folderId: string, input: UpdateFolderInput): Promise<ProjectDto> {
  const projectId = await folderProjectId(userId, folderId);
  return mutateProject(projectId, async (tx) => {
    if (input.parentId !== undefined) {
      await checkFolder(tx, projectId, input.parentId);
      if (input.parentId === folderId) throw badRequest("Un dossier ne peut pas être son propre parent.");
      // Interdit : déplacer un dossier dans sa propre descendance.
      const all = await tx.folder.findMany({ where: { projectId }, select: { id: true, parentId: true } });
      const parentOf = new Map(all.map((f) => [f.id, f.parentId]));
      for (let cur: string | null = input.parentId; cur; cur = parentOf.get(cur) ?? null) {
        if (cur === folderId) throw badRequest("Impossible de déplacer un dossier dans sa propre arborescence.");
      }
    }
    await tx.folder.update({ where: { id: folderId }, data: { name: input.name, parentId: input.parentId } });
  });
}

/** Supprime un dossier : ses documents et sous-dossiers remontent dans le dossier parent. */
export async function deleteFolder(userId: string, folderId: string): Promise<ProjectDto> {
  const projectId = await folderProjectId(userId, folderId);
  return mutateProject(projectId, async (tx) => {
    const f = await tx.folder.findUniqueOrThrow({ where: { id: folderId }, select: { parentId: true } });
    await tx.document.updateMany({ where: { folderId }, data: { folderId: f.parentId } });
    await tx.folder.updateMany({ where: { parentId: folderId }, data: { parentId: f.parentId } });
    await tx.folder.delete({ where: { id: folderId } });
  });
}
