import "server-only";
import type { DeliverableStatus, Prisma, ProjectStatus, TaskComplexity, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { sanitizeNotes } from "@/lib/sanitize";
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

export type Progress = { percent: number; total: number; done: number };

export type MemberDto = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  color: string | null;
};

export type TaskDto = {
  id: string;
  ownerId: string;
  /** Projet, étape, activité : facultatifs et cohérents (activité ⇒ étape ⇒ projet). null = tâche « sans projet ». */
  projectId: string | null;
  stageId: string | null;
  activityId: string | null;
  assigneeId: string | null;
  name: string;
  description: string;
  status: TaskStatus;
  progress: number;
  /** Basse · Moyenne · Haute · Critique. */
  priority: TaskPriority;
  /** Complexité estimée : Basse · Moyenne · Forte (vue « Sélection »). */
  complexity: TaskComplexity;
  order: number;
  startDate: string | null;
  dueDate: string | null;
  commentCount: number;
  /** Des notes riches existent (« Prise de notes »). */
  hasNotes: boolean;
  /** Nœuds de carte mentale auxquels la tâche est rattachée. */
  nodeIds: string[];
  updatedAt: string;
};

export type ActivityDto = {
  id: string;
  stageId: string;
  name: string;
  description: string;
  hasNotes: boolean;
  order: number;
  progress: Progress;
  tasks: TaskDto[];
};

export type StageDto = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  hasNotes: boolean;
  order: number;
  startDate: string | null;
  dueDate: string | null;
  progress: Progress;
  activities: ActivityDto[];
  /** Tâches rattachées directement à l'étape (sans activité). */
  tasks: TaskDto[];
};

export type FolderDto = { id: string; parentId: string | null; name: string };

export type DocumentDto = {
  id: string;
  folderId: string | null;
  deliverableId: string | null;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  /** Téléchargement authentifié. */
  url: string;
};

export type DeliverableDto = {
  id: string;
  stageId: string | null;
  assigneeId: string | null;
  name: string;
  description: string;
  status: DeliverableStatus;
  expectedStart: string | null;
  expectedEnd: string | null;
  deliveredAt: string | null;
  order: number;
  documents: DocumentDto[];
};

export type ProjectSummary = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  color: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  progress: Progress;
  stageCount: number;
  memberCount: number;
  deliverableCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDto = ProjectSummary & {
  /** Notes riches du projet (HTML assaini). */
  notes: string;
  stages: StageDto[];
  /** Tâches du projet sans étape. */
  tasks: TaskDto[];
  members: MemberDto[];
  deliverables: DeliverableDto[];
  documents: DocumentDto[];
  folders: FolderDto[];
};

type Tx = Prisma.TransactionClient;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Un HTML de notes contient-il quelque chose (texte ou image) ? */
export function hasHtmlContent(html: string): boolean {
  return html.includes("<img") || html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

export function aggregate(progresses: number[]): Progress {
  const total = progresses.length;
  if (total === 0) return { percent: 0, total: 0, done: 0 };
  const sum = progresses.reduce((a, b) => a + b, 0);
  return { percent: Math.round(sum / total), total, done: progresses.filter((p) => p >= 100).length };
}

// --- Sélections Prisma -------------------------------------------------------

const TASK_INCLUDE = { _count: { select: { comments: true } }, nodes: { select: { nodeId: true } } } satisfies Prisma.TaskInclude;

const DOCUMENT_INCLUDE = { uploadedBy: { select: { id: true, name: true } } } satisfies Prisma.DocumentInclude;

export const PROJECT_INCLUDE = {
  stages: {
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      activities: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      tasks: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: TASK_INCLUDE },
    },
  },
  tasks: { where: { stageId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: TASK_INCLUDE },
  members: { orderBy: { createdAt: "asc" } },
  deliverables: {
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { documents: { orderBy: { createdAt: "desc" }, include: DOCUMENT_INCLUDE } },
  },
  documents: { orderBy: { createdAt: "desc" }, include: DOCUMENT_INCLUDE },
  folders: { orderBy: [{ name: "asc" }] },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;
type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

export function toTaskDto(t: TaskRow): TaskDto {
  return {
    id: t.id,
    ownerId: t.ownerId,
    projectId: t.projectId,
    stageId: t.stageId,
    activityId: t.activityId,
    assigneeId: t.assigneeId,
    name: t.name,
    description: t.description,
    status: t.status,
    progress: t.progress,
    priority: t.priority,
    complexity: t.complexity,
    order: t.order,
    startDate: iso(t.startDate),
    dueDate: iso(t.dueDate),
    commentCount: t._count.comments,
    hasNotes: hasHtmlContent(t.notes),
    nodeIds: t.nodes.map((n) => n.nodeId),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toMemberDto(m: { id: string; userId: string | null; name: string; email: string | null; role: string | null; color: string | null }): MemberDto {
  return { id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role, color: m.color };
}

export function toDocumentDto(d: DocumentRow): DocumentDto {
  return {
    id: d.id,
    folderId: d.folderId,
    deliverableId: d.deliverableId,
    name: d.name,
    originalName: d.originalName,
    mimeType: d.mimeType,
    size: d.size,
    uploadedBy: d.uploadedBy,
    createdAt: d.createdAt.toISOString(),
    url: `/api/v1/documents/${d.id}/download`,
  };
}

function toProjectDto(p: ProjectRow): ProjectDto {
  const stages: StageDto[] = p.stages.map((s) => {
    const activities: ActivityDto[] = s.activities.map((a) => {
      const tasks = s.tasks.filter((t) => t.activityId === a.id).map(toTaskDto);
      return {
        id: a.id,
        stageId: a.stageId,
        name: a.name,
        description: a.description,
        hasNotes: hasHtmlContent(a.notes),
        order: a.order,
        progress: aggregate(tasks.map((t) => t.progress)),
        tasks,
      };
    });
    return {
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      description: s.description,
      hasNotes: hasHtmlContent(s.notes),
      order: s.order,
      startDate: iso(s.startDate),
      dueDate: iso(s.dueDate),
      progress: aggregate(s.tasks.map((t) => t.progress)),
      activities,
      tasks: s.tasks.filter((t) => t.activityId === null).map(toTaskDto),
    };
  });
  const allTasks = [...p.stages.flatMap((s) => s.tasks), ...p.tasks];
  return {
    id: p.id,
    ownerId: p.ownerId,
    name: p.name,
    description: p.description,
    color: p.color,
    status: p.status,
    startDate: iso(p.startDate),
    dueDate: iso(p.dueDate),
    progress: aggregate(allTasks.map((t) => t.progress)),
    stageCount: p.stages.length,
    memberCount: p.members.length,
    deliverableCount: p.deliverables.length,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    notes: sanitizeNotes(p.notes),
    stages,
    tasks: p.tasks.map(toTaskDto),
    members: p.members.map(toMemberDto),
    deliverables: p.deliverables.map((d) => ({
      id: d.id,
      stageId: d.stageId,
      assigneeId: d.assigneeId,
      name: d.name,
      description: d.description,
      status: d.status,
      expectedStart: iso(d.expectedStart),
      expectedEnd: iso(d.expectedEnd),
      deliveredAt: iso(d.deliveredAt),
      order: d.order,
      documents: d.documents.map(toDocumentDto),
    })),
    documents: p.documents.map(toDocumentDto),
    folders: p.folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
  };
}

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

/**
 * « Ma » tâche : affectée à un membre rattaché à mon compte, ou non affectée
 * dans un projet dont je suis propriétaire (usage solo).
 */
export function isMyTask(t: { assignee: { userId: string | null } | null }, projectOwnerId: string, userId: string): boolean {
  return t.assignee ? t.assignee.userId === userId : projectOwnerId === userId;
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

export async function getProject(userId: string, projectId: string): Promise<ProjectDto> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, include: PROJECT_INCLUDE });
  if (!p) throw notFound("Projet");
  return toProjectDto(p);
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  const p = await prisma.project.create({
    data: {
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

export async function createStage(userId: string, projectId: string, input: CreateStageInput): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.stage.count({ where: { projectId } });
    await tx.stage.create({
      data: {
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

export async function createActivity(userId: string, stageId: string, input: CreateActivityInput): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.activity.count({ where: { stageId } });
    await tx.activity.create({ data: { stageId, name: input.name, description: input.description, order: count } });
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

/**
 * Cohérence statut / avancement : DONE ⇔ 100 %, TODO ⇔ 0 %, sinon IN_PROGRESS.
 * CLOSED (clôture manuelle, après DONE) force 100 % ; une tâche clôturée dont
 * on rabaisse l'avancement est rouverte (IN_PROGRESS) ; 100 % sur une tâche
 * déjà clôturée la laisse clôturée.
 */
export function reconcile(
  current: { status: TaskStatus; progress: number },
  input: { status?: TaskStatus; progress?: number },
): { status: TaskStatus; progress: number } {
  let { status, progress } = current;
  if (input.progress !== undefined) {
    progress = input.progress;
    if (progress >= 100) status = status === "CLOSED" ? "CLOSED" : "DONE";
    else status = progress <= 0 ? "TODO" : "IN_PROGRESS";
  }
  if (input.status !== undefined) {
    status = input.status;
    if (status === "DONE" || status === "CLOSED") progress = 100;
    else if (status === "TODO") progress = 0;
    else if (progress <= 0 || progress >= 100) progress = 50;
  }
  return { status, progress };
}

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

export async function createTask(
  userId: string,
  target: { projectId?: string | null; stageId?: string | null; activityId?: string | null; nodeId?: string | null },
  input: CreateTaskInput,
): Promise<TaskMutation> {
  const att = await resolveAttachment(userId, target);
  await checkNode(prisma, userId, target.nodeId);
  return mutateTask(att.projectId, async (tx) => {
    if (input.assigneeId) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      await checkMember(tx, att.projectId, input.assigneeId);
    }
    const { status, progress } = reconcile({ status: "TODO", progress: 0 }, input);
    const count = await tx.task.count({ where: siblingWhere({ ...att, ownerId: userId }) });
    const created = await tx.task.create({
      data: {
        ownerId: userId,
        projectId: att.projectId,
        stageId: att.stageId,
        activityId: att.activityId,
        assigneeId: input.assigneeId ?? null,
        name: input.name,
        description: input.description,
        status,
        progress,
        priority: input.priority ?? "MEDIUM",
        complexity: input.complexity ?? "MEDIUM",
        order: count,
        startDate: toDate(input.startDate) ?? null,
        dueDate: toDate(input.dueDate) ?? null,
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
  const moved = att.projectId !== t.projectId || att.stageId !== t.stageId || att.activityId !== t.activityId;
  const projectChanged = att.projectId !== t.projectId;

  return mutateTask(att.projectId, async (tx) => {
    const { status, progress } = reconcile(t, input);
    // Changement de projet : l'affectation (membre de l'ancien projet) tombe, sauf nouvelle affectation valide.
    let assigneeId = input.assigneeId;
    if (projectChanged && assigneeId === undefined) assigneeId = null;
    if (assigneeId) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      await checkMember(tx, att.projectId, assigneeId);
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
        startDate: toDate(input.startDate),
        dueDate: toDate(input.dueDate),
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
    if (moved) changes.push("rattachement");
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
