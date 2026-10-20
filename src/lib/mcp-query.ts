import "server-only";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { htmlToText } from "@/lib/sanitize";
import { projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { mapAccessWhere } from "@/lib/map-access";
import { meetingStatus } from "@/lib/meetings";
import { fileTypeLabel } from "@/lib/shared/file-types";
import { JOURNAL_BLOCK_LABEL, JOURNAL_WRITTEN_BLOCKS, isWrittenBlock, resolveJournalBlock } from "@/lib/shared/journal";
import { richText } from "@/lib/rich-text";
import { STRATEGY_LABEL } from "@/lib/shared/risks";

/**
 * Requête générique du connecteur MCP (`query_objects`) : tous les objets de
 * Second Brain, filtrés, triés par date de création ou de modification, dans
 * le périmètre de l'utilisateur (ou toute la plateforme pour un
 * administrateur qui le demande explicitement — jamais les modèles ni les
 * conversations des autres). Chaque objet porte `createdAt` / `updatedAt`,
 * son auteur quand il existe et son contexte (projet, carte…).
 *
 * Exemples : « mes 3 derniers comptes-rendus » → { entity: "meeting",
 * author: "me", limit: 3 } ; « tâches créées cette semaine par Alice » →
 * { entity: "task", author: "Alice", created_after: "2026-10-12" }.
 */

export const QUERY_ENTITIES = [
  "project",
  "stage",
  "activity",
  "task",
  "comment",
  "meeting",
  "risk",
  "deliverable",
  "document",
  "folder",
  "mind_map",
  "node",
  "conversation",
  "message",
  "notification",
  "journal_entry",
] as const;
export type QueryEntity = (typeof QUERY_ENTITIES)[number];

export type QueryArgs = {
  entity: QueryEntity;
  /** « me » ou un nom (créateur / rédacteur / auteur selon l'objet). */
  author?: string;
  /** Responsable (tâches, livrables, risques). */
  assignee?: string;
  project_id?: string;
  map_id?: string;
  task_id?: string;
  status?: string;
  text?: string;
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
  sort?: "created" | "updated";
  order?: "desc" | "asc";
  limit?: number;
  with_content?: boolean;
  all?: boolean;
};

const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Date « AAAA-MM-JJ » (début de journée UTC) ou ISO complète. */
function dateArg(v: string | undefined, name: string, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "BAD_ARGUMENT", `« ${name} » : date invalide (AAAA-MM-JJ ou ISO).`);
  return d;
}

function content(html: string | null | undefined, full: boolean): string | undefined {
  if (!html) return undefined;
  const t = htmlToText(html, full ? 200_000 : 400);
  return t || undefined;
}

export async function queryObjects(user: Pick<User, "id" | "name">, a: QueryArgs): Promise<{ entity: QueryEntity; count: number; items: unknown[] }> {
  if (!QUERY_ENTITIES.includes(a.entity)) throw new ApiError(400, "BAD_ARGUMENT", `entity : une des valeurs ${QUERY_ENTITIES.join(", ")}.`);
  const all = !!a.all;
  const limit = Math.max(1, Math.min(200, Math.floor(a.limit ?? 20)));
  const full = a.with_content === true;
  const dir: Prisma.SortOrder = a.order === "asc" ? "asc" : "desc";
  const by = a.sort === "updated" ? "updated" : "created";
  const range = (field: "createdAt" | "updatedAt", after?: string, before?: string) => {
    const gte = dateArg(after, `${field === "createdAt" ? "created" : "updated"}_after`);
    const lte = dateArg(before, `${field === "createdAt" ? "created" : "updated"}_before`, true);
    return gte || lte ? { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {};
  };
  const dates = { ...range("createdAt", a.created_after, a.created_before), ...range("updatedAt", a.updated_after, a.updated_before) };
  const me = (a.author ?? "").trim().toLowerCase() === "me" || (a.author ?? "").trim().toLowerCase() === "moi";
  const authorName = !me && a.author?.trim() ? a.author.trim() : null;
  /** Filtre auteur sur une relation User (`id` = moi, sinon nom). */
  const userFilter = (rel: string, idField: string) => (me ? { [idField]: user.id } : authorName ? { [rel]: { name: ci(authorName) } } : {});

  const projectScope: Prisma.ProjectWhereInput = all ? { isTemplate: false } : projectAccessWhere(user.id);
  const inProject = a.project_id ? { projectId: a.project_id } : {};
  const updatedOrder = (hasUpdated: boolean): { updatedAt: Prisma.SortOrder } | { createdAt: Prisma.SortOrder } => (by === "updated" && hasUpdated ? { updatedAt: dir } : { createdAt: dir });

  switch (a.entity) {
    case "project": {
      const rows = await prisma.project.findMany({
        where: { AND: [projectScope, a.project_id ? { id: a.project_id } : {}, userFilter("owner", "ownerId"), a.status ? { status: a.status as Prisma.EnumProjectStatusFilter["equals"] } : {}, a.text ? { OR: [{ name: ci(a.text) }, { description: ci(a.text) }] } : {}, dates] },
        orderBy: updatedOrder(true),
        take: limit,
        include: { owner: { select: { name: true } }, _count: { select: { tasks: true, stages: true, members: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((p) => ({ id: p.id, name: p.name, status: p.status, owner: p.owner.name, description: p.description || undefined, notes: content(p.notes, full), startDate: iso(p.startDate), dueDate: iso(p.dueDate), tasks: p._count.tasks, stages: p._count.stages, members: p._count.members, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) })) };
    }
    case "stage": {
      const rows = await prisma.stage.findMany({
        where: { project: projectScope, ...inProject, ...(a.text ? { OR: [{ name: ci(a.text) }, { description: ci(a.text) }] } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { project: { select: { id: true, name: true } }, _count: { select: { tasks: true, activities: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((s) => ({ id: s.id, name: s.name, project: s.project, description: s.description || undefined, notes: content(s.notes, full), startDate: iso(s.startDate), dueDate: iso(s.dueDate), tasks: s._count.tasks, activities: s._count.activities, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt) })) };
    }
    case "activity": {
      const rows = await prisma.activity.findMany({
        where: { stage: { project: projectScope, ...inProject }, ...(a.text ? { OR: [{ name: ci(a.text) }, { description: ci(a.text) }] } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { stage: { select: { id: true, name: true, project: { select: { id: true, name: true } } } }, _count: { select: { tasks: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((x) => ({ id: x.id, name: x.name, project: x.stage.project, stage: { id: x.stage.id, name: x.stage.name }, description: x.description || undefined, notes: content(x.notes, full), tasks: x._count.tasks, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt) })) };
    }
    case "task": {
      const status = a.status === "open" ? { status: { in: ["TODO", "IN_PROGRESS"] as ("TODO" | "IN_PROGRESS")[] } } : a.status ? { status: a.status as "TODO" } : {};
      const rows = await prisma.task.findMany({
        where: {
          AND: [
            all ? { OR: [{ project: { isTemplate: false } }, { projectId: null }] } : taskAccessWhere(user.id),
            inProject,
            userFilter("owner", "ownerId"),
            a.assignee ? (a.assignee.toLowerCase() === "me" || a.assignee.toLowerCase() === "moi" ? { assignee: { userId: user.id } } : { assignee: { name: ci(a.assignee) } }) : {},
            status,
            a.text ? { OR: [{ name: ci(a.text) }, { description: ci(a.text) }] } : {},
            dates,
          ],
        },
        orderBy: updatedOrder(true),
        take: limit,
        include: { project: { select: { id: true, name: true } }, stage: { select: { name: true } }, activity: { select: { name: true } }, owner: { select: { name: true } }, assignee: { select: { name: true } }, _count: { select: { comments: true } } },
      });
      return {
        entity: a.entity,
        count: rows.length,
        items: rows.map((t) => ({
          id: t.id,
          name: t.name,
          project: t.project,
          stage: t.stage?.name ?? undefined,
          activity: t.activity?.name ?? undefined,
          status: t.status,
          priority: t.priority,
          progress: t.progress,
          createdBy: t.owner.name,
          assignee: t.assignee?.name ?? undefined,
          description: richText(t.description) || undefined,
          notes: content(t.notes, full),
          startDate: iso(t.startDate),
          dueDate: iso(t.dueDate),
          closedAt: iso(t.closedAt),
          comments: t._count.comments,
          createdAt: iso(t.createdAt),
          updatedAt: iso(t.updatedAt),
        })),
      };
    }
    case "comment": {
      const rows = await prisma.taskComment.findMany({
        where: {
          AND: [
            { task: all ? { OR: [{ project: { isTemplate: false } }, { projectId: null }] } : taskAccessWhere(user.id) },
            a.project_id ? { task: { projectId: a.project_id } } : {},
            a.task_id ? { taskId: a.task_id } : {},
            userFilter("author", "authorId"),
            a.text ? { body: ci(a.text) } : {},
            dates,
          ],
        },
        orderBy: updatedOrder(true),
        take: limit,
        include: { author: { select: { name: true } }, task: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((c) => ({ id: c.id, author: c.author.name, task: { id: c.task.id, name: c.task.name }, project: c.task.project, replyTo: c.parentId ?? undefined, text: full ? c.body : c.body.slice(0, 400), createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) })) };
    }
    case "meeting": {
      const rows = await prisma.meeting.findMany({
        where: { project: projectScope, ...inProject, ...userFilter("author", "authorId"), ...(a.text ? { OR: [{ title: ci(a.text) }, { minutes: ci(a.text) }] } : {}), ...dates },
        orderBy: by === "updated" ? { updatedAt: dir } : { createdAt: dir },
        take: a.status ? 500 : limit,
        include: { project: { select: { id: true, name: true } }, author: { select: { name: true } }, participants: { include: { member: { select: { name: true } } } }, approvers: { include: { member: { select: { name: true } } } } },
      });
      const filtered = (a.status ? rows.filter((m) => meetingStatus(m) === a.status) : rows).slice(0, limit);
      return {
        entity: a.entity,
        count: filtered.length,
        items: filtered.map((m) => ({
          id: m.id,
          title: m.title,
          project: m.project,
          date: iso(m.date),
          author: m.author?.name ?? undefined,
          participants: m.participants.map((p) => p.member.name),
          status: meetingStatus(m),
          approvers: m.approvers.map((x) => ({ name: x.member.name, decision: x.decision, comment: x.comment || undefined, decidedAt: iso(x.decidedAt) })),
          minutes: content(m.minutes, full),
          minutesUpdatedAt: iso(m.minutesUpdatedAt),
          createdAt: iso(m.createdAt),
          updatedAt: iso(m.updatedAt),
        })),
      };
    }
    case "risk": {
      const rows = await prisma.risk.findMany({
        where: { project: projectScope, ...inProject, ...(a.status ? { status: a.status as "OPEN" } : {}), ...(a.assignee ? { owner: { name: ci(a.assignee) } } : {}), ...(a.text ? { OR: [{ title: ci(a.text) }, { description: ci(a.text) }, { response: ci(a.text) }] } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { project: { select: { id: true, name: true } }, owner: { select: { name: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, project: r.project, category: r.category || undefined, probability: r.probability, impact: r.impact, score: r.probability * r.impact, status: r.status, strategy: r.strategy ? STRATEGY_LABEL[r.kind][r.strategy] : undefined, owner: r.owner?.name ?? undefined, description: content(r.description, full), response: content(r.response, full), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) })) };
    }
    case "deliverable": {
      const rows = await prisma.deliverable.findMany({
        where: { project: projectScope, ...inProject, ...(a.status ? { status: a.status as "PLANNED" } : {}), ...(a.assignee ? { assignee: { name: ci(a.assignee) } } : {}), ...(a.text ? { OR: [{ name: ci(a.text) }, { description: ci(a.text) }] } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { project: { select: { id: true, name: true } }, stage: { select: { name: true } }, assignee: { select: { name: true } }, _count: { select: { documents: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((d) => ({ id: d.id, name: d.name, project: d.project, stage: d.stage?.name ?? undefined, status: d.status, assignee: d.assignee?.name ?? undefined, expectedStart: iso(d.expectedStart), expectedEnd: iso(d.expectedEnd), deliveredAt: iso(d.deliveredAt), documents: d._count.documents, description: d.description || undefined, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt) })) };
    }
    case "document": {
      const rows = await prisma.document.findMany({
        where: { project: projectScope, ...inProject, ...userFilter("uploadedBy", "uploadedById"), ...(a.text ? { OR: [{ name: ci(a.text) }, { originalName: ci(a.text) }] } : {}), ...range("createdAt", a.created_after, a.created_before) },
        orderBy: { createdAt: dir },
        take: limit,
        include: { project: { select: { id: true, name: true } }, folder: { select: { name: true } }, deliverable: { select: { name: true } }, uploadedBy: { select: { name: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((d) => ({ id: d.id, name: d.name, type: fileTypeLabel(d.mimeType, d.originalName), sizeKb: Math.round(d.size / 1024), project: d.project, folder: d.folder?.name ?? undefined, deliverable: d.deliverable?.name ?? undefined, uploadedBy: d.uploadedBy?.name ?? undefined, download: `/api/v1/documents/${d.id}/download`, createdAt: iso(d.createdAt) })) };
    }
    case "folder": {
      const rows = await prisma.folder.findMany({
        where: { project: projectScope, ...inProject, ...(a.text ? { name: ci(a.text) } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { project: { select: { id: true, name: true } }, parent: { select: { name: true } }, _count: { select: { documents: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((f) => ({ id: f.id, name: f.name, project: f.project, parent: f.parent?.name ?? undefined, documents: f._count.documents, createdAt: iso(f.createdAt), updatedAt: iso(f.updatedAt) })) };
    }
    case "mind_map": {
      const rows = await prisma.mindMap.findMany({
        where: { AND: [all ? { isTemplate: false } : mapAccessWhere(user.id), a.map_id ? { id: a.map_id } : {}, userFilter("owner", "ownerId"), a.text ? { title: ci(a.text) } : {}, dates] },
        orderBy: updatedOrder(true),
        take: limit,
        include: { owner: { select: { name: true } }, _count: { select: { nodes: true, shares: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((m) => ({ id: m.id, title: m.title, owner: m.owner.name, nodes: m._count.nodes, sharedWith: m._count.shares, createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt) })) };
    }
    case "node": {
      const rows = await prisma.mindNode.findMany({
        where: { map: all ? { isTemplate: false } : mapAccessWhere(user.id), ...(a.map_id ? { mapId: a.map_id } : {}), ...(a.status ? { status: a.status as "OPEN" } : {}), ...(a.text ? { OR: [{ title: ci(a.text) }, { notes: ci(a.text) }] } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { map: { select: { id: true, title: true } }, parent: { select: { title: true } }, _count: { select: { tasks: true, children: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((n) => ({ id: n.id, title: n.title, map: n.map, parent: n.parent?.title ?? undefined, status: n.status, notes: content(n.notes, full), children: n._count.children, tasks: n._count.tasks, createdAt: iso(n.createdAt), updatedAt: iso(n.updatedAt) })) };
    }
    case "conversation": {
      // Toujours mes conversations (jamais celles des autres, même administrateur).
      const rows = await prisma.conversation.findMany({
        where: { participants: { some: { userId: user.id } }, ...(a.text ? { title: ci(a.text) } : {}), ...range("createdAt", a.created_after, a.created_before) },
        orderBy: by === "updated" ? { lastMessageAt: dir } : { createdAt: dir },
        take: limit,
        include: { participants: { include: { user: { select: { name: true } } } }, _count: { select: { messages: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((c) => ({ id: c.id, title: c.title || undefined, participants: c.participants.map((p) => p.user.name), messages: c._count.messages, createdAt: iso(c.createdAt), lastMessageAt: iso(c.lastMessageAt) })) };
    }
    case "message": {
      const rows = await prisma.message.findMany({
        where: { conversation: { participants: { some: { userId: user.id } } }, deletedAt: null, ...userFilter("author", "authorId"), ...(a.text ? { body: ci(a.text) } : {}), ...dates },
        orderBy: updatedOrder(true),
        take: limit,
        include: { author: { select: { name: true } }, conversation: { select: { id: true, title: true } } },
      });
      return { entity: a.entity, count: rows.length, items: rows.map((m) => ({ id: m.id, conversation: { id: m.conversation.id, title: m.conversation.title || undefined }, author: m.author?.name ?? undefined, text: content(m.body, full), createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt) })) };
    }
    case "notification": {
      const rows = await prisma.notification.findMany({
        where: { userId: user.id, ...(a.status === "unread" ? { readAt: null } : a.status === "read" ? { readAt: { not: null } } : {}), ...(a.text ? { OR: [{ title: ci(a.text) }, { body: ci(a.text) }] } : {}), ...range("createdAt", a.created_after, a.created_before) },
        orderBy: { createdAt: dir },
        take: limit,
      });
      return { entity: a.entity, count: rows.length, items: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body || undefined, actor: n.actorName ?? undefined, href: n.href, read: !!n.readAt, createdAt: iso(n.createdAt) })) };
    }
    case "journal_entry": {
      // Journal quotidien : toujours personnel ; status = bloc (clé ou libellé).
      const block = a.status ? resolveJournalBlock(a.status) : null;
      if (a.status && (!block || !isWrittenBlock(block))) throw new ApiError(400, "BAD_ARGUMENT", `status : un bloc du journal (${JOURNAL_WRITTEN_BLOCKS.map((b) => JOURNAL_BLOCK_LABEL[b]).join(", ")}).`);
      const rows = await prisma.journalEntry.findMany({
        where: { userId: user.id, ...(block && isWrittenBlock(block) ? { block } : {}), ...(a.text ? { content: ci(a.text) } : {}), ...dates },
        orderBy: by === "updated" ? { updatedAt: dir } : [{ day: dir }, { createdAt: dir }],
        take: limit,
      });
      return { entity: a.entity, count: rows.length, items: rows.map((e) => ({ id: e.id, day: e.day.toISOString().slice(0, 10), block: JOURNAL_BLOCK_LABEL[e.block], text: content(e.content, full), createdAt: iso(e.createdAt), updatedAt: iso(e.updatedAt) })) };
    }
  }
}
