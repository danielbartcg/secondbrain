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

/** Identifiants de membres mentionnés dans un commentaire. */
export function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) ids.add(m[2]);
  return [...ids];
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
  // Seules les mentions de membres du projet sont retenues.
  const candidates = extractMentions(body);
  const valid = candidates.length
    ? (await prisma.projectMember.findMany({ where: { id: { in: candidates }, projectId: t.stage.projectId }, select: { id: true } })).map((m) => m.id)
    : [];
  await prisma.taskComment.create({ data: { taskId, authorId: userId, body, mentions: valid } });
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
