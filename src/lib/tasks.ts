import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { isMyTask, projectAccessWhere, taskHref, toMemberDto, toTaskDto, type MemberDto, type TaskDto } from "@/lib/projects";

/**
 * Fiche tâche : détail enrichi (projet, étape, activité, responsable, équipe),
 * fil de commentaires hiérarchique (réponses imbriquées, profondeur libre)
 * avec mentions `@[Nom](memberId)`, sessions de travail planifiées.
 * Organisation personnelle : « mes tâches » (calendrier, matrice, synthèse).
 */

export type TaskCommentDto = {
  id: string;
  /** Commentaire parent (réponse) ; null = racine du fil. */
  parentId: string | null;
  authorId: string;
  authorName: string;
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

export type TaskDetailDto = TaskDto & {
  project: { id: string; name: string; color: string | null; ownerId: string; members: MemberDto[] };
  stage: { id: string; name: string };
  activity: { id: string; name: string } | null;
  assignee: MemberDto | null;
  comments: TaskCommentDto[];
  workSessions: WorkSessionDto[];
};

const MENTION_RE = /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g;
const BARE_MENTION_RE = /@\[([^\]]+)\](?!\()/g;

/**
 * Normalise les mentions d'un commentaire : `@[Nom]` (tel que saisi dans
 * l'interface) devient `@[Nom](memberId)` si un membre du projet porte ce nom
 * (insensible à la casse) ; les identifiants déjà présents sont vérifiés.
 * Renvoie le corps normalisé et les membres effectivement mentionnés.
 */
export function resolveMentions(body: string, members: Array<{ id: string; name: string }>): { body: string; mentions: string[] } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m]));
  const ids = new Set<string>();
  let out = body.replace(BARE_MENTION_RE, (whole, name: string) => {
    const m = byName.get(name.trim().toLowerCase());
    if (!m) return whole;
    ids.add(m.id);
    return `@[${m.name}](${m.id})`;
  });
  out = out.replace(MENTION_RE, (whole, name: string, id: string) => {
    const m = byId.get(id);
    if (!m) return `@[${name}]`;
    ids.add(m.id);
    return `@[${m.name}](${m.id})`;
  });
  return { body: out, mentions: [...ids] };
}

/** `Date` (colonne DATE, minuit UTC) → `AAAA-MM-JJ`. */
export const dayString = (d: Date) => d.toISOString().slice(0, 10);

function toSessionDto(s: { id: string; date: Date; userId: string; user: { name: string } }, userId: string, dueDate: Date | null): WorkSessionDto {
  const date = dayString(s.date);
  return { id: s.id, date, userId: s.userId, userName: s.user.name, mine: s.userId === userId, late: dueDate ? date > dayString(dueDate) : false };
}

const SESSION_INCLUDE = { user: { select: { name: true } } } satisfies Prisma.WorkSessionInclude;

export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetailDto> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, stage: { project: projectAccessWhere(userId) } },
    include: {
      _count: { select: { comments: true } },
      assignee: true,
      activity: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, project: { select: { id: true, name: true, color: true, ownerId: true, members: { orderBy: { createdAt: "asc" } } } } } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
      workSessions: { orderBy: { date: "asc" }, include: SESSION_INCLUDE },
    },
  });
  if (!t) throw notFound("Tâche");
  return {
    ...toTaskDto(t),
    project: {
      id: t.stage.project.id,
      name: t.stage.project.name,
      color: t.stage.project.color,
      ownerId: t.stage.project.ownerId,
      members: t.stage.project.members.map(toMemberDto),
    },
    stage: { id: t.stage.id, name: t.stage.name },
    activity: t.activity,
    assignee: t.assignee ? toMemberDto(t.assignee) : null,
    comments: t.comments.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.author.name,
      body: c.body,
      mentions: c.mentions,
      createdAt: c.createdAt.toISOString(),
    })),
    workSessions: t.workSessions.map((s) => toSessionDto(s, userId, t.dueDate)),
  };
}

// --- Commentaires ------------------------------------------------------------

export async function addComment(userId: string, taskId: string, body: string, parentId?: string | null): Promise<TaskDetailDto> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, stage: { project: projectAccessWhere(userId) } },
    select: { id: true, name: true, assignee: { select: { userId: true } }, stage: { select: { projectId: true } } },
  });
  if (!t) throw notFound("Tâche");
  const projectId = t.stage.projectId;
  let parent: { id: string; authorId: string } | null = null;
  if (parentId) {
    parent = await prisma.taskComment.findFirst({ where: { id: parentId, taskId }, select: { id: true, authorId: true } });
    if (!parent) throw badRequest("Le commentaire auquel vous répondez n'existe plus.");
  }
  // Seules les mentions de membres du projet sont retenues ; `@[Nom]` est résolu par nom.
  const members = await prisma.projectMember.findMany({ where: { projectId }, select: { id: true, name: true, userId: true } });
  const resolved = resolveMentions(body, members);
  const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

  await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({
      data: { taskId, authorId: userId, parentId: parent?.id ?? null, body: resolved.body, mentions: resolved.mentions },
    });
    await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });

    const href = `${taskHref(projectId, taskId)}#comment-${comment.id}`;
    const excerpt = body.length > 140 ? body.slice(0, 137) + "…" : body;
    const common = { actorId: userId, actorName: author.name, href, taskId, projectId };
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
    where: { id: commentId, task: { stage: { project: projectAccessWhere(userId) } } },
    select: { id: true, taskId: true, authorId: true, task: { select: { stage: { select: { project: { select: { ownerId: true } } } } } } },
  });
  if (!c) throw notFound("Commentaire");
  if (c.authorId !== userId && c.task.stage.project.ownerId !== userId) throw forbidden();
  // Les réponses sont supprimées en cascade (fil).
  await prisma.taskComment.delete({ where: { id: commentId } });
  return getTaskDetail(userId, c.taskId);
}

// --- Sessions de travail -----------------------------------------------------

async function accessibleTask(userId: string, taskId: string) {
  const t = await prisma.task.findFirst({
    where: { id: taskId, stage: { project: projectAccessWhere(userId) } },
    select: { id: true, dueDate: true },
  });
  if (!t) throw notFound("Tâche");
  return t;
}

async function sessionsOf(userId: string, taskId: string, dueDate: Date | null): Promise<WorkSessionDto[]> {
  const rows = await prisma.workSession.findMany({ where: { taskId }, orderBy: { date: "asc" }, include: SESSION_INCLUDE });
  return rows.map((s) => toSessionDto(s, userId, dueDate));
}

/** Planifie une session de travail (idempotent pour un même jour). */
export async function addWorkSession(userId: string, taskId: string, date: string): Promise<WorkSessionDto[]> {
  const t = await accessibleTask(userId, taskId);
  const day = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw badRequest("Date invalide.");
  await prisma.workSession.upsert({
    where: { taskId_userId_date: { taskId, userId, date: day } },
    create: { taskId, userId, date: day },
    update: {},
  });
  return sessionsOf(userId, taskId, t.dueDate);
}

/** Retire une de ses propres sessions. */
export async function deleteWorkSession(userId: string, sessionId: string): Promise<WorkSessionDto[]> {
  const s = await prisma.workSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, taskId: true, task: { select: { dueDate: true } } } });
  if (!s) throw notFound("Session");
  await prisma.workSession.delete({ where: { id: s.id } });
  return sessionsOf(userId, s.taskId, s.task.dueDate);
}

// --- Organisation personnelle : « mes tâches » --------------------------------

export type OrganizerTask = TaskDto & {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  stageName: string;
  activityName: string | null;
  assigneeName: string | null;
  /** Ordre relatif personnel (vue Synthèse) ; null = jamais ordonnée. */
  rank: number | null;
  /** Mes sessions de travail planifiées sur cette tâche. */
  sessions: Array<{ id: string; date: string; late: boolean }>;
};

export type OrganizerDto = {
  /** Mes tâches des projets actifs ou en pause (ouvertes et terminées). */
  tasks: OrganizerTask[];
};

const PRIORITY_WEIGHT = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export async function getMyTasks(userId: string): Promise<OrganizerDto> {
  const rows = await prisma.task.findMany({
    where: { stage: { project: { ...projectAccessWhere(userId), status: { in: ["ACTIVE", "ON_HOLD"] } } } },
    include: {
      _count: { select: { comments: true } },
      assignee: { select: { name: true, userId: true } },
      activity: { select: { name: true } },
      stage: { select: { name: true, project: { select: { id: true, name: true, color: true, ownerId: true } } } },
      ranks: { where: { userId }, select: { rank: true } },
      workSessions: { where: { userId }, orderBy: { date: "asc" }, select: { id: true, date: true } },
    },
  });
  const tasks = rows
    .filter((t) => isMyTask(t, t.stage.project.ownerId, userId))
    .map<OrganizerTask>((t) => ({
      ...toTaskDto(t),
      projectId: t.stage.project.id,
      projectName: t.stage.project.name,
      projectColor: t.stage.project.color,
      stageName: t.stage.name,
      activityName: t.activity?.name ?? null,
      assigneeName: t.assignee?.name ?? null,
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
  const accessible = await prisma.task.findMany({
    where: { id: { in: unique }, stage: { project: projectAccessWhere(userId) } },
    select: { id: true },
  });
  const ok = new Set(accessible.map((t) => t.id));
  const ordered = unique.filter((id) => ok.has(id));
  await prisma.$transaction(
    ordered.map((taskId, rank) =>
      prisma.taskRank.upsert({ where: { userId_taskId: { userId, taskId } }, create: { userId, taskId, rank }, update: { rank } }),
    ),
  );
}
