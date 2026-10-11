import "server-only";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound } from "@/lib/api";
import { projectAccessWhere, toMemberDto, toTaskDto, type MemberDto, type TaskDto } from "@/lib/projects";

/**
 * Fiche tâche : détail enrichi (projet, étape, activité, responsable, équipe)
 * et fil de commentaires avec mentions `@[Nom](memberId)`.
 */

export type TaskCommentDto = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
};

export type TaskDetailDto = TaskDto & {
  project: { id: string; name: string; color: string | null; ownerId: string; members: MemberDto[] };
  stage: { id: string; name: string };
  activity: { id: string; name: string } | null;
  assignee: MemberDto | null;
  comments: TaskCommentDto[];
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

export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetailDto> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, stage: { project: projectAccessWhere(userId) } },
    include: {
      _count: { select: { comments: true } },
      assignee: true,
      activity: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, project: { select: { id: true, name: true, color: true, ownerId: true, members: { orderBy: { createdAt: "asc" } } } } } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
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
      authorId: c.authorId,
      authorName: c.author.name,
      body: c.body,
      mentions: c.mentions,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export async function addComment(userId: string, taskId: string, body: string): Promise<TaskDetailDto> {
  const t = await prisma.task.findFirst({ where: { id: taskId, stage: { project: projectAccessWhere(userId) } }, select: { id: true, stage: { select: { projectId: true } } } });
  if (!t) throw notFound("Tâche");
  // Seules les mentions de membres du projet sont retenues ; `@[Nom]` est résolu par nom.
  const members = await prisma.projectMember.findMany({ where: { projectId: t.stage.projectId }, select: { id: true, name: true } });
  const resolved = resolveMentions(body, members);
  await prisma.taskComment.create({ data: { taskId, authorId: userId, body: resolved.body, mentions: resolved.mentions } });
  await prisma.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
  return getTaskDetail(userId, taskId);
}

export async function deleteComment(userId: string, commentId: string): Promise<TaskDetailDto> {
  const c = await prisma.taskComment.findFirst({
    where: { id: commentId, task: { stage: { project: projectAccessWhere(userId) } } },
    select: { id: true, taskId: true, authorId: true, task: { select: { stage: { select: { project: { select: { ownerId: true } } } } } } },
  });
  if (!c) throw notFound("Commentaire");
  if (c.authorId !== userId && c.task.stage.project.ownerId !== userId) throw forbidden();
  await prisma.taskComment.delete({ where: { id: commentId } });
  return getTaskDetail(userId, c.taskId);
}
