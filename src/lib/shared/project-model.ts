import type { DeliverableStatus, Prisma, ProjectStatus, TaskComplexity, TaskPriority, TaskStatus } from "@prisma/client";
import { sanitizeNotes } from "@/lib/sanitize";
import { readCustomValues } from "./custom-fields";

/**
 * Modèle « projets » pur (sans accès base ni 'server-only') : types DTO,
 * sélections Prisma, constructeurs de DTO et règles métier. Partagé par le
 * serveur (src/lib/projects.ts, qui le réexporte) et par le client hors ligne
 * des applications (native/), qui reconstruit les mêmes DTO depuis sa base
 * locale. Toute modification ici change les deux côtés.
 */

export type Progress = { percent: number; total: number; done: number };

export type MemberDto = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  color: string | null;
  /** Photo du compte rattaché (null = silhouette). */
  avatarUrl: string | null;
};

/** Inclusion de la photo du compte rattaché à un membre. */
export const MEMBER_INCLUDE = { user: { select: { avatarUrl: true } } } satisfies Prisma.ProjectMemberInclude;

export type TaskDto = {
  id: string;
  ownerId: string;
  /** Projet, étape, activité : facultatifs et cohérents (activité ⇒ étape ⇒ projet). null = tâche « sans projet ». */
  projectId: string | null;
  stageId: string | null;
  activityId: string | null;
  assigneeId: string | null;
  /** Superviseur (un membre) et contributeurs (plusieurs). */
  supervisorId: string | null;
  contributorIds: string[];
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
  /** Date de clôture (null si la tâche n'est pas clôturée). */
  closedAt: string | null;
  commentCount: number;
  /** Des notes riches existent (« Prise de notes »). */
  hasNotes: boolean;
  /** Nœuds de carte mentale auxquels la tâche est rattachée. */
  nodeIds: string[];
  /** Tâches prérequises (même projet). */
  prerequisiteIds: string[];
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
  /** Champs personnalisés : { fieldId: texte | id d'option } (voir shared/custom-fields). */
  customFields: Record<string, string>;
  /** Projet type (modèle) : édité dans l'administration, sans dates ni équipe. */
  isTemplate: boolean;
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


export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

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

export const TASK_INCLUDE = { _count: { select: { comments: true } }, nodes: { select: { nodeId: true } }, contributors: { select: { memberId: true } } } satisfies Prisma.TaskInclude;

export const DOCUMENT_INCLUDE = { uploadedBy: { select: { id: true, name: true } } } satisfies Prisma.DocumentInclude;

export const PROJECT_INCLUDE = {
  stages: {
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      activities: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      tasks: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: TASK_INCLUDE },
    },
  },
  tasks: { where: { stageId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: TASK_INCLUDE },
  members: { orderBy: { createdAt: "asc" }, include: MEMBER_INCLUDE },
  deliverables: {
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { documents: { orderBy: { createdAt: "desc" }, include: DOCUMENT_INCLUDE } },
  },
  documents: { orderBy: { createdAt: "desc" }, include: DOCUMENT_INCLUDE },
  folders: { orderBy: [{ name: "asc" }] },
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;
export type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

export function toTaskDto(t: TaskRow): TaskDto {
  return {
    id: t.id,
    ownerId: t.ownerId,
    projectId: t.projectId,
    stageId: t.stageId,
    activityId: t.activityId,
    assigneeId: t.assigneeId,
    supervisorId: t.supervisorId,
    contributorIds: t.contributors.map((c) => c.memberId),
    name: t.name,
    description: t.description,
    status: t.status,
    progress: t.progress,
    priority: t.priority,
    complexity: t.complexity,
    order: t.order,
    startDate: iso(t.startDate),
    dueDate: iso(t.dueDate),
    closedAt: iso(t.closedAt),
    commentCount: t._count.comments,
    hasNotes: hasHtmlContent(t.notes),
    nodeIds: t.nodes.map((n) => n.nodeId),
    prerequisiteIds: t.prerequisiteIds ?? [],
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toMemberDto(m: {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  color: string | null;
  user?: { avatarUrl: string | null } | null;
}): MemberDto {
  return { id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role, color: m.color, avatarUrl: m.user?.avatarUrl ?? null };
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

export function toProjectDto(p: ProjectRow): ProjectDto {
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
    customFields: readCustomValues((p as { customFields?: unknown }).customFields),
    isTemplate: !!(p as { isTemplate?: boolean }).isTemplate,
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

// --- Règles métier pures ---------------------------------------------------------

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

/**
 * « Ma » tâche : affectée à un membre rattaché à mon compte (responsable,
 * superviseur ou contributeur), ou non affectée dans un projet dont je suis
 * propriétaire (usage solo).
 */
export function isMyTask(
  t: { assignee: { userId: string | null } | null; supervisor?: { userId: string | null } | null; contributors?: Array<{ member: { userId: string | null } }> },
  projectOwnerId: string,
  userId: string,
): boolean {
  if (t.assignee?.userId === userId) return true;
  if (t.supervisor?.userId === userId) return true;
  if (t.contributors?.some((c) => c.member.userId === userId)) return true;
  return !t.assignee && projectOwnerId === userId;
}

