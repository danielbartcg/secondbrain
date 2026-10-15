import "server-only";
import type { Prisma, User } from "@prisma/client";
import { requireAdmin } from "@/lib/users";
import { prisma } from "@/lib/prisma";
import { actorDisplayName, frDate, listTaskEventsRaw, recordTaskEvents, type TaskEventDto } from "@/lib/task-events";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { isAdmin } from "@/lib/roles";
import { mapAccessWhere } from "@/lib/map-access";
import { MEMBER_INCLUDE, TASK_PEOPLE_SELECT, accessibleTask, checkNode, isMyTask, taskAccessWhere, taskHref, toMemberDto, toTaskDto, type MemberDto, type TaskDto } from "@/lib/projects";
import { sanitizeNotes } from "@/lib/sanitize";
import { NO_PROJECT_LABEL, dayString, resolveMentions } from "@/lib/shared/task-model";
export { NO_PROJECT_LABEL, dayString, resolveMentions };

/**
 * Fiche tâche : détail enrichi (projet, étape, activité, responsable, équipe,
 * nœuds de carte), fil de commentaires hiérarchique (réponses imbriquées,
 * profondeur libre) avec mentions `@[Nom](memberId)`, sessions de travail
 * planifiées. Organisation personnelle : « mes tâches » (calendrier, matrice,
 * synthèse). Rattachement des tâches aux nœuds de carte mentale.
 *
 * Une tâche peut n'avoir ni projet, ni étape, ni activité (« sans projet ») :
 * elle n'est alors visible que par son créateur (`ownerId`).
 */


export type TaskCommentDto = {
  id: string;
  /** Commentaire parent (réponse) ; null = racine du fil. */
  parentId: string | null;
  authorId: string;
  authorName: string;
  /** Photo de l'auteur (null = silhouette). */
  authorAvatarUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
};

export type WorkSessionDto = {
  id: string;
  /** Jour `AAAA-MM-JJ`. */
  date: string;
  userId: string;
  userName: string;
  /** Session de l'utilisateur courant. */
  mine: boolean;
  /** Après l'échéance de la tâche. */
  late: boolean;
};

export type TaskNodeRef = { id: string; title: string; mapId: string; mapTitle: string };

export type TaskDetailDto = TaskDto & {
  /** null = tâche sans projet. */
  project: { id: string; name: string; color: string | null; ownerId: string; members: MemberDto[] } | null;
  stage: { id: string; name: string } | null;
  activity: { id: string; name: string } | null;
  assignee: MemberDto | null;
  supervisor: MemberDto | null;
  contributors: MemberDto[];
  comments: TaskCommentDto[];
  workSessions: WorkSessionDto[];
  /** Nœuds de carte mentale rattachés. */
  nodes: TaskNodeRef[];
  /** Notes riches (HTML assaini), éditables dans « Prise de notes ». */
  notes: string;
  /** Faux en consultation (administrateur, manager d'un N-1) : fiche en lecture seule. */
  canEdit: boolean;
};


function toSessionDto(s: { id: string; date: Date; userId: string; user: { name: string } }, userId: string, dueDate: Date | null): WorkSessionDto {
  const date = dayString(s.date);
  return { id: s.id, date, userId: s.userId, userName: s.user.name, mine: s.userId === userId, late: dueDate ? date > dayString(dueDate) : false };
}

const SESSION_INCLUDE = { user: { select: { name: true } } } satisfies Prisma.WorkSessionInclude;
const TASK_BASE_INCLUDE = { _count: { select: { comments: true } }, nodes: { select: { nodeId: true } }, contributors: { select: { memberId: true } } } satisfies Prisma.TaskInclude;

/**
 * Tâches « d'une personne » (même définition que `isMyTask`) : responsable,
 * superviseur, contributeur, ou non affectée dans un de ses projets, ou sans
 * projet et créée par elle. Sert à la vue manager (tâches des N-1).
 */
export function tasksOfUsersWhere(userIds: string[]): Prisma.TaskWhereInput {
  return {
    OR: [
      { assignee: { userId: { in: userIds } } },
      { supervisor: { userId: { in: userIds } } },
      { contributors: { some: { member: { userId: { in: userIds } } } } },
      { assigneeId: null, project: { ownerId: { in: userIds } } },
      { projectId: null, ownerId: { in: userIds } },
    ],
  };
}

/**
 * Lecture d'une tâche hors de mes accès : un administrateur lit tout ; un
 * manager lit les tâches de ses N-1 directs. Aucune modification possible.
 */
async function canConsultTask(userId: string, taskId: string): Promise<boolean> {
  const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, reports: { select: { id: true } } } });
  if (!viewer) return false;
  if (isAdmin(viewer)) return (await prisma.task.count({ where: { id: taskId } })) > 0;
  const reports = viewer.reports.map((r) => r.id);
  if (reports.length === 0) return false;
  return (await prisma.task.count({ where: { id: taskId, ...tasksOfUsersWhere(reports) } })) > 0;
}

/** Piste d'audit d'une tâche (mêmes droits de lecture que la fiche). */
export async function getTaskHistory(userId: string, taskId: string): Promise<TaskEventDto[]> {
  const canEdit = (await prisma.task.count({ where: { id: taskId, ...taskAccessWhere(userId) } })) > 0;
  if (!canEdit && !(await canConsultTask(userId, taskId))) throw notFound("Tâche");
  return listTaskEventsRaw(taskId);
}

const commentExcerpt = (s: string, n = 120) => {
  const t = s.replace(/@\[([^\]]+)\]/g, "@$1").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetailDto> {
  const canEdit = (await prisma.task.count({ where: { id: taskId, ...taskAccessWhere(userId) } })) > 0;
  if (!canEdit && !(await canConsultTask(userId, taskId))) throw notFound("Tâche");
  const t = await prisma.task.findFirst({
    where: { id: taskId },
    include: {
      ...TASK_BASE_INCLUDE,
      assignee: { include: MEMBER_INCLUDE },
      supervisor: { include: MEMBER_INCLUDE },
      contributors: { include: { member: { include: MEMBER_INCLUDE } } },
      activity: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true, ownerId: true, members: { orderBy: { createdAt: "asc" }, include: MEMBER_INCLUDE } } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, avatarUrl: true } } } },
      workSessions: { orderBy: { date: "asc" }, include: SESSION_INCLUDE },
      // Cartes accessibles à l'utilisateur seulement (les siennes et celles qu'on lui a partagées).
      nodes: { where: { node: { map: mapAccessWhere(userId) } }, select: { nodeId: true, node: { select: { id: true, title: true, mapId: true, map: { select: { title: true } } } } } },
    },
  });
  if (!t) throw notFound("Tâche");
  return {
    canEdit,
    ...toTaskDto(t),
    project: t.project
      ? { id: t.project.id, name: t.project.name, color: t.project.color, ownerId: t.project.ownerId, members: t.project.members.map(toMemberDto) }
      : null,
    stage: t.stage,
    activity: t.activity,
    assignee: t.assignee ? toMemberDto(t.assignee) : null,
    supervisor: t.supervisor ? toMemberDto(t.supervisor) : null,
    contributors: t.contributors.map((c) => toMemberDto(c.member)),
    comments: t.comments.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.author.name,
      authorAvatarUrl: c.author.avatarUrl,
      body: c.body,
      mentions: c.mentions,
      createdAt: c.createdAt.toISOString(),
    })),
    workSessions: t.workSessions.map((s) => toSessionDto(s, userId, t.dueDate)),
    nodes: t.nodes.map((n) => ({ id: n.node.id, title: n.node.title, mapId: n.node.mapId, mapTitle: n.node.map.title })),
    notes: sanitizeNotes(t.notes),
  };
}

// --- Commentaires ------------------------------------------------------------

export async function addComment(userId: string, taskId: string, body: string, parentId?: string | null, id?: string): Promise<TaskDetailDto> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, ...taskAccessWhere(userId) },
    select: { id: true, name: true, projectId: true, assignee: { select: { userId: true } } },
  });
  if (!t) throw notFound("Tâche");
  let parent: { id: string; authorId: string } | null = null;
  if (parentId) {
    parent = await prisma.taskComment.findFirst({ where: { id: parentId, taskId }, select: { id: true, authorId: true } });
    if (!parent) throw badRequest("Le commentaire auquel vous répondez n'existe plus.");
  }
  // Seules les mentions de membres du projet sont retenues ; `@[Nom]` est résolu par nom.
  const members = t.projectId ? await prisma.projectMember.findMany({ where: { projectId: t.projectId }, select: { id: true, name: true, userId: true } }) : [];
  const resolved = resolveMentions(body, members);
  const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

  await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({
      data: { id, taskId, authorId: userId, parentId: parent?.id ?? null, body: resolved.body, mentions: resolved.mentions },
    });
    await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
    await recordTaskEvents(tx, [
      {
        taskId,
        actorId: userId,
        actorName: author.name,
        kind: "comment",
        newValue: commentExcerpt(resolved.body, 500),
        message: `${author.name} a ${parent ? "répondu à un commentaire" : "commenté"} : « ${commentExcerpt(resolved.body)} »`,
      },
    ]);

    const href = `${taskHref(taskId)}#comment-${comment.id}`;
    const excerpt = body.length > 140 ? body.slice(0, 137) + "…" : body;
    const common = { actorId: userId, actorName: author.name, href, taskId, projectId: t.projectId };
    const items = [];
    if (parent) {
      items.push({ ...common, userId: parent.authorId, type: "REPLY" as const, title: `${author.name} a répondu à votre commentaire sur « ${t.name} »`, body: excerpt });
    }
    for (const id of resolved.mentions) {
      const m = members.find((x) => x.id === id);
      if (m?.userId && m.userId !== parent?.authorId) {
        items.push({ ...common, userId: m.userId, type: "MENTION" as const, title: `${author.name} vous a mentionné sur « ${t.name} »`, body: excerpt });
      }
    }
    if (t.assignee?.userId && t.assignee.userId !== parent?.authorId && !resolved.mentions.some((id) => members.find((m) => m.id === id)?.userId === t.assignee?.userId)) {
      items.push({ ...common, userId: t.assignee.userId, type: "TASK_UPDATED" as const, title: `${author.name} a commenté « ${t.name} »`, body: excerpt });
    }
    await notify(tx, items);
  });
  return getTaskDetail(userId, taskId);
}

export async function deleteComment(userId: string, commentId: string): Promise<TaskDetailDto> {
  const c = await prisma.taskComment.findFirst({
    where: { id: commentId, task: taskAccessWhere(userId) },
    select: { id: true, taskId: true, authorId: true, task: { select: { ownerId: true, project: { select: { ownerId: true } } } } },
  });
  if (!c) throw notFound("Commentaire");
  const owner = c.task.project?.ownerId ?? c.task.ownerId;
  if (c.authorId !== userId && owner !== userId) throw forbidden();
  // Les réponses sont supprimées en cascade (fil).
  await prisma.$transaction(async (tx) => {
    const body = (await tx.taskComment.findUnique({ where: { id: commentId }, select: { body: true } }))?.body ?? "";
    await tx.taskComment.delete({ where: { id: commentId } });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(tx, [{ taskId: c.taskId, actorId: userId, actorName: actor, kind: "comment", oldValue: commentExcerpt(body, 500), message: `${actor} a supprimé un commentaire (« ${commentExcerpt(body, 60)} »)` }]);
  });
  return getTaskDetail(userId, c.taskId);
}

// --- Sessions de travail -----------------------------------------------------

async function sessionsOf(userId: string, taskId: string, dueDate: Date | null): Promise<WorkSessionDto[]> {
  const rows = await prisma.workSession.findMany({ where: { taskId }, orderBy: { date: "asc" }, include: SESSION_INCLUDE });
  return rows.map((s) => toSessionDto(s, userId, dueDate));
}

/** Planifie une session de travail (idempotent pour un même jour). */
export async function addWorkSession(userId: string, taskId: string, date: string, id?: string): Promise<WorkSessionDto[]> {
  const t = await accessibleTask(userId, taskId);
  const day = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw badRequest("Date invalide.");
  await prisma.$transaction(async (tx) => {
    const existing = await tx.workSession.findUnique({ where: { taskId_userId_date: { taskId, userId, date: day } }, select: { id: true } });
    if (existing) return;
    await tx.workSession.create({ data: { id, taskId, userId, date: day } });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(tx, [{ taskId, actorId: userId, actorName: actor, kind: "session", newValue: frDate(day), message: `${actor} a planifié une session de travail le ${frDate(day)}` }]);
  });
  return sessionsOf(userId, taskId, t.dueDate);
}

/** Retire une de ses propres sessions. */
export async function deleteWorkSession(userId: string, sessionId: string): Promise<WorkSessionDto[]> {
  const s = await prisma.workSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, taskId: true, date: true, task: { select: { dueDate: true } } } });
  if (!s) throw notFound("Session");
  await prisma.$transaction(async (tx) => {
    await tx.workSession.delete({ where: { id: s.id } });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(tx, [{ taskId: s.taskId, actorId: userId, actorName: actor, kind: "session", oldValue: frDate(s.date), message: `${actor} a retiré sa session de travail du ${frDate(s.date)}` }]);
  });
  return sessionsOf(userId, s.taskId, s.task.dueDate);
}

// --- Organisation personnelle : « mes tâches » --------------------------------

export type OrganizerTask = TaskDto & {
  /** null = sans projet. */
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  stageName: string | null;
  activityName: string | null;
  assigneeName: string | null;
  /** Pourquoi la tâche est « à moi » (filtres du Kanban). */
  roles: { assigned: boolean; supervising: boolean; contributing: boolean; owner: boolean };
  /** Ordre relatif personnel (vue Synthèse) ; null = jamais ordonnée. */
  rank: number | null;
  /** Mes sessions de travail planifiées sur cette tâche. */
  sessions: Array<{ id: string; date: string; late: boolean }>;
};

export type OrganizerDto = {
  /** Mes tâches des projets actifs ou en pause + mes tâches sans projet (ouvertes et terminées). */
  tasks: OrganizerTask[];
};

const PRIORITY_WEIGHT = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export async function getMyTasks(userId: string): Promise<OrganizerDto> {
  const rows = await prisma.task.findMany({
    // Filtre « à moi » en base (et non après coup) : seules mes tâches sont chargées.
    where: { AND: [taskAccessWhere(userId), tasksOfUsersWhere([userId]), { OR: [{ projectId: null }, { project: { status: { in: ["ACTIVE", "ON_HOLD"] } } }] }] },
    include: {
      ...TASK_BASE_INCLUDE,
      ...TASK_PEOPLE_SELECT,
      activity: { select: { name: true } },
      stage: { select: { name: true } },
      project: { select: { id: true, name: true, color: true, ownerId: true } },
      ranks: { where: { userId }, select: { rank: true } },
      workSessions: { where: { userId }, orderBy: { date: "asc" }, select: { id: true, date: true } },
    },
  });
  const tasks = rows
    .filter((t) => isMyTask(t, t.project?.ownerId ?? t.ownerId, userId))
    .map<OrganizerTask>((t) => ({
      ...toTaskDto(t),
      projectId: t.project?.id ?? null,
      projectName: t.project?.name ?? NO_PROJECT_LABEL,
      projectColor: t.project?.color ?? null,
      stageName: t.stage?.name ?? null,
      activityName: t.activity?.name ?? null,
      assigneeName: t.assignee?.name ?? null,
      roles: {
        assigned: t.assignee?.userId === userId,
        supervising: t.supervisor?.userId === userId,
        contributing: t.contributors.some((c) => c.member.userId === userId),
        owner: !t.assignee && (t.project?.ownerId ?? t.ownerId) === userId,
      },
      rank: t.ranks[0]?.rank ?? null,
      sessions: t.workSessions.map((s) => ({ id: s.id, date: dayString(s.date), late: t.dueDate ? dayString(s.date) > dayString(t.dueDate) : false })),
    }));
  tasks.sort((a, b) => {
    if (a.rank !== null || b.rank !== null) {
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      if (a.rank !== b.rank) return a.rank - b.rank;
    }
    const d = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    if (d !== 0) return d;
    return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  });
  return { tasks };
}

/** Enregistre l'ordre relatif personnel : `taskIds` dans l'ordre voulu (tâches accessibles uniquement). */
export async function orderMyTasks(userId: string, taskIds: string[]): Promise<void> {
  const unique = [...new Set(taskIds)];
  const accessible = await prisma.task.findMany({ where: { id: { in: unique }, ...taskAccessWhere(userId) }, select: { id: true } });
  const ok = new Set(accessible.map((t) => t.id));
  const ordered = unique.filter((id) => ok.has(id));
  await prisma.$transaction(
    ordered.map((taskId, rank) =>
      prisma.taskRank.upsert({ where: { userId_taskId: { userId, taskId } }, create: { userId, taskId, rank }, update: { rank } }),
    ),
  );
}

// --- Tâches d'un nœud de carte mentale -----------------------------------------

export type NodeTaskDto = TaskDto & { projectName: string; projectColor: string | null };

export type NodeTasksResult = {
  nodeId: string;
  tasks: NodeTaskDto[];
  /** Nombre de tâches, et de tâches non clôturées (terminées comprises). */
  taskCount: number;
  openTaskCount: number;
};

/** Tâches du nœud **accessibles** à l'utilisateur (une tâche d'un projet quitté n'apparaît plus). */
async function nodeTasksResult(userId: string, nodeId: string): Promise<NodeTasksResult> {
  const rows = await prisma.task.findMany({
    where: { AND: [{ nodes: { some: { nodeId } } }, taskAccessWhere(userId)] },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: { ...TASK_BASE_INCLUDE, project: { select: { name: true, color: true } } },
  });
  const tasks = rows.map<NodeTaskDto>((t) => ({ ...toTaskDto(t), projectName: t.project?.name ?? NO_PROJECT_LABEL, projectColor: t.project?.color ?? null }));
  return { nodeId, tasks, taskCount: tasks.length, openTaskCount: tasks.filter((t) => t.status !== "CLOSED").length };
}

export async function listNodeTasks(userId: string, nodeId: string): Promise<NodeTasksResult> {
  await checkNode(prisma, userId, nodeId, "read");
  return nodeTasksResult(userId, nodeId);
}

/** Rattache une tâche existante (accessible) à un nœud d'une carte modifiable par l'utilisateur. Idempotent. */
export async function linkNodeTask(userId: string, nodeId: string, taskId: string): Promise<NodeTasksResult> {
  await checkNode(prisma, userId, nodeId);
  await accessibleTask(userId, taskId);
  await prisma.$transaction(async (tx) => {
    const exists = await tx.mindNodeTask.findUnique({ where: { nodeId_taskId: { nodeId, taskId } } });
    if (exists) return;
    await tx.mindNodeTask.create({ data: { nodeId, taskId } });
    await tx.mindNode.update({ where: { id: nodeId }, data: { updatedAt: new Date() } });
    const node = await tx.mindNode.findUnique({ where: { id: nodeId }, select: { title: true, map: { select: { title: true } } } });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(tx, [{ taskId, actorId: userId, actorName: actor, kind: "node", newValue: node?.title ?? null, message: `${actor} a rattaché la tâche au nœud « ${node?.title ?? "?"} » (carte « ${node?.map.title ?? "?"} »)` }]);
  });
  return nodeTasksResult(userId, nodeId);
}

export async function unlinkNodeTask(userId: string, nodeId: string, taskId: string): Promise<NodeTasksResult> {
  await checkNode(prisma, userId, nodeId);
  await prisma.$transaction(async (tx) => {
    const removed = await tx.mindNodeTask.deleteMany({ where: { nodeId, taskId } });
    if (removed.count === 0) return;
    const node = await tx.mindNode.findUnique({ where: { id: nodeId }, select: { title: true } });
    const actor = await actorDisplayName(tx, userId);
    await recordTaskEvents(tx, [{ taskId, actorId: userId, actorName: actor, kind: "node", oldValue: node?.title ?? null, message: `${actor} a détaché la tâche du nœud « ${node?.title ?? "?"} »` }]);
  });
  return nodeTasksResult(userId, nodeId);
}

// --- Consultation : équipe (manager) et administration ------------------------------

export type OverviewTask = TaskDto & {
  projectName: string;
  projectColor: string | null;
  stageName: string | null;
  ownerName: string;
  assigneeName: string | null;
  supervisorName: string | null;
  contributorNames: string[];
  /** Personnes concernées (comptes) : responsable, superviseur, contributeurs, ou propriétaire si non affectée. */
  peopleUserIds: string[];
};

const OVERVIEW_INCLUDE = {
  ...TASK_BASE_INCLUDE,
  owner: { select: { id: true, name: true } },
  project: { select: { name: true, color: true, ownerId: true } },
  stage: { select: { name: true } },
  assignee: { select: { name: true, userId: true } },
  supervisor: { select: { name: true, userId: true } },
  contributors: { select: { memberId: true, member: { select: { name: true, userId: true } } } },
} satisfies Prisma.TaskInclude;

type OverviewRow = Prisma.TaskGetPayload<{ include: typeof OVERVIEW_INCLUDE }>;

function toOverview(t: OverviewRow): OverviewTask {
  const people = new Set<string>();
  if (t.assignee?.userId) people.add(t.assignee.userId);
  if (t.supervisor?.userId) people.add(t.supervisor.userId);
  for (const c of t.contributors) if (c.member.userId) people.add(c.member.userId);
  if (!t.assignee) people.add(t.project?.ownerId ?? t.ownerId);
  return {
    ...toTaskDto(t),
    projectName: t.project?.name ?? NO_PROJECT_LABEL,
    projectColor: t.project?.color ?? null,
    stageName: t.stage?.name ?? null,
    ownerName: t.owner.name,
    assigneeName: t.assignee?.name ?? null,
    supervisorName: t.supervisor?.name ?? null,
    contributorNames: t.contributors.map((c) => c.member.name),
    peopleUserIds: [...people],
  };
}

/** Tâches de mes N-1 directs (manager), groupées côté client par personne. */
export async function listTeamTasks(userId: string): Promise<{ members: Array<{ id: string; name: string; email: string; avatarUrl: string | null }>; tasks: OverviewTask[] }> {
  const members = await prisma.user.findMany({ where: { managerId: userId }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, avatarUrl: true } });
  if (members.length === 0) return { members, tasks: [] };
  const rows = await prisma.task.findMany({
    where: tasksOfUsersWhere(members.map((m) => m.id)),
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    include: OVERVIEW_INCLUDE,
  });
  return { members, tasks: rows.map(toOverview) };
}

/** Toutes les tâches (administration ; lecture seule, rôle vérifié ici). */
export async function listAllTasksAdmin(admin: Pick<User, "email" | "role">): Promise<OverviewTask[]> {
  requireAdmin(admin);
  const rows = await prisma.task.findMany({ orderBy: [{ updatedAt: "desc" }], take: 5000, include: OVERVIEW_INCLUDE });
  return rows.map(toOverview);
}
