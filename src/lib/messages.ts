import "server-only";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { htmlToText, sanitizeNotes } from "@/lib/sanitize";
import { isAdmin } from "@/lib/roles";

/**
 * Messagerie interne : conversations entre deux utilisateurs ou plus.
 *
 * - Accès : uniquement les participants (`requireParticipant`).
 * - « Vu / non vu » : `ConversationParticipant.lastReadAt` ; un message est
 *   non lu pour moi s'il vient de quelqu'un d'autre et est postérieur à ma
 *   dernière lecture. Mes messages sont « vus » par les participants dont
 *   `lastReadAt` est postérieur.
 * - Suppression : par l'auteur, le contenu est effacé et la place reste
 *   (« Message supprimé »), y compris dans les citations de réponses.
 * - Réponse : `replyToId` cite un message précis du même fil.
 * - Chaque nouveau message notifie (type MESSAGE) les autres participants.
 */

export type ContactDto = { id: string; name: string; email: string; avatarUrl: string | null };

export type ParticipantDto = { id: string; name: string; avatarUrl: string | null; lastReadAt: string | null };

export type MessageDto = {
  id: string;
  authorId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  /** HTML assaini ; vide si supprimé. */
  body: string;
  deleted: boolean;
  createdAt: string;
  replyTo: { id: string; authorName: string; excerpt: string; deleted: boolean } | null;
};

export type ConversationSummaryDto = {
  id: string;
  title: string;
  participants: ParticipantDto[];
  lastMessage: { authorName: string; excerpt: string; deleted: boolean; createdAt: string; mine: boolean } | null;
  lastMessageAt: string;
  unreadCount: number;
};

export type ConversationDto = {
  id: string;
  title: string;
  participants: ParticipantDto[];
  messages: MessageDto[];
  /** Il existe des messages plus anciens (pagination « before »). */
  hasMore: boolean;
  /** Horodatage serveur à repasser en `since` au prochain rafraîchissement. */
  serverTime: string;
};

const PAGE = 50;
const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true, avatarUrl: true } },
  replyTo: { select: { id: true, body: true, deletedAt: true, author: { select: { name: true } } } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

function toMessageDto(m: MessageRow): MessageDto {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    authorId: m.authorId,
    authorName: m.author?.name ?? "Utilisateur supprimé",
    authorAvatarUrl: m.author?.avatarUrl ?? null,
    body: deleted ? "" : sanitizeNotes(m.body),
    deleted,
    createdAt: m.createdAt.toISOString(),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author?.name ?? "Utilisateur supprimé",
          excerpt: m.replyTo.deletedAt ? "" : htmlToText(m.replyTo.body, 140) || "(image)",
          deleted: m.replyTo.deletedAt !== null,
        }
      : null,
  };
}

async function requireParticipant(userId: string, conversationId: string) {
  const p = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  // Même réponse que pour une conversation inexistante : on ne révèle pas son existence.
  if (!p) throw notFound("Conversation");
  return p;
}

async function participantsOf(conversationId: string): Promise<ParticipantDto[]> {
  const rows = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((p) => ({ id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl, lastReadAt: p.lastReadAt?.toISOString() ?? null }));
}

/** Contenu d'un message : assaini, non vide (texte ou image). */
function cleanBody(html: string): string {
  const body = sanitizeNotes(html).trim();
  if (!htmlToText(body) && !/<img\b/i.test(body)) throw badRequest("Le message est vide.");
  return body;
}

// --- Contacts ----------------------------------------------------------------------------------

/**
 * Personnes proposées pour démarrer une conversation : membres de mes projets,
 * mon manager et mes N-1, mes interlocuteurs passés (tout le monde pour un
 * administrateur). Les autres se trouvent par e-mail exact (/users/lookup).
 */
export async function listContacts(user: User): Promise<ContactDto[]> {
  if (isAdmin(user)) {
    return prisma.user.findMany({ where: { id: { not: user.id } }, select: USER_SELECT, orderBy: { name: "asc" }, take: 500 });
  }
  const projectIds = (
    await prisma.project.findMany({
      where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
      select: { id: true },
    })
  ).map((p) => p.id);
  return prisma.user.findMany({
    where: {
      id: { not: user.id },
      OR: [
        { projects: { some: { id: { in: projectIds } } } },
        { memberships: { some: { projectId: { in: projectIds } } } },
        { id: user.managerId ?? "__none__" },
        { managerId: user.id },
        { conversations: { some: { conversation: { participants: { some: { userId: user.id } } } } } },
      ],
    },
    select: USER_SELECT,
    orderBy: { name: "asc" },
    take: 500,
  });
}

// --- Lecture -------------------------------------------------------------------------------------

export async function listConversations(userId: string): Promise<ConversationSummaryDto[]> {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { joinedAt: "asc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { author: { select: { name: true } } } },
    },
  });
  const unread = await unreadByConversation(userId);
  return rows.map((c) => {
    const last = c.messages[0];
    return {
      id: c.id,
      title: c.title,
      participants: c.participants.map((p) => ({ id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl, lastReadAt: p.lastReadAt?.toISOString() ?? null })),
      lastMessage: last
        ? {
            authorName: last.author?.name ?? "Utilisateur supprimé",
            excerpt: last.deletedAt ? "" : htmlToText(last.body, 120) || "(image)",
            deleted: last.deletedAt !== null,
            createdAt: last.createdAt.toISOString(),
            mine: last.authorId === userId,
          }
        : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unreadCount: unread.get(c.id) ?? 0,
    };
  });
}

async function unreadByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ conversationId: string; n: bigint }[]>`
    SELECT m."conversationId", COUNT(*) AS n
    FROM "Message" m
    JOIN "ConversationParticipant" p ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
    WHERE m."deletedAt" IS NULL
      AND m."authorId" IS DISTINCT FROM ${userId}
      AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
    GROUP BY m."conversationId"`;
  return new Map(rows.map((r) => [r.conversationId, Number(r.n)]));
}

/** Nombre total de messages non lus (badge du menu). */
export async function unreadMessagesCount(userId: string): Promise<number> {
  let total = 0;
  for (const n of (await unreadByConversation(userId)).values()) total += n;
  return total;
}

/**
 * Fil d'une conversation. Sans option : les derniers messages. `before` (id
 * de message) : la page précédente. `since` (ISO) : messages créés ou
 * supprimés depuis (rafraîchissement périodique).
 */
export async function getConversation(userId: string, id: string, opts: { before?: string; since?: string } = {}): Promise<ConversationDto> {
  await requireParticipant(userId, id);
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!conversation) throw notFound("Conversation");
  const serverTime = new Date();
  let where: Prisma.MessageWhereInput = { conversationId: id };
  if (opts.since) {
    const since = new Date(opts.since);
    if (Number.isNaN(since.getTime())) throw badRequest("Paramètre since invalide.");
    where = { conversationId: id, updatedAt: { gt: since } };
  } else if (opts.before) {
    const ref = await prisma.message.findFirst({ where: { id: opts.before, conversationId: id }, select: { createdAt: true } });
    if (!ref) throw notFound("Message");
    where = { conversationId: id, createdAt: { lt: ref.createdAt } };
  }
  const rows = await prisma.message.findMany({
    where,
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: opts.since ? 500 : PAGE + 1,
  });
  const hasMore = !opts.since && rows.length > PAGE;
  const page = (hasMore ? rows.slice(0, PAGE) : rows).reverse();
  return { id, title: conversation.title, participants: await participantsOf(id), messages: page.map(toMessageDto), hasMore, serverTime: serverTime.toISOString() };
}

// --- Écriture ------------------------------------------------------------------------------------

async function postInTx(tx: Prisma.TransactionClient, author: User, conversationId: string, html: string, replyToId: string | null) {
  if (replyToId) {
    const target = await tx.message.findFirst({ where: { id: replyToId, conversationId }, select: { id: true } });
    if (!target) throw badRequest("Le message cité n'appartient pas à cette conversation.");
  }
  const now = new Date();
  const message = await tx.message.create({
    data: { conversationId, authorId: author.id, body: cleanBody(html), replyToId, createdAt: now },
    include: MESSAGE_INCLUDE,
  });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  // Écrire vaut lecture : tout ce qui précède mon message est vu.
  await tx.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: author.id } }, data: { lastReadAt: now } });
  const conv = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { title: true, participants: { select: { userId: true } } } });
  const excerpt = htmlToText(message.body, 160) || "(image)";
  await notify(
    tx,
    conv.participants.map((p) => ({
      userId: p.userId,
      type: "MESSAGE" as const,
      title: conv.title ? `${author.name} dans « ${conv.title} »` : `Message de ${author.name}`,
      body: excerpt,
      href: `/messages/${conversationId}`,
      actorId: author.id,
      actorName: author.name,
    })),
  );
  return toMessageDto(message);
}

export async function createConversation(
  author: User,
  input: { participantIds: string[]; title?: string; body?: string },
): Promise<{ conversationId: string; created: boolean }> {
  const others = [...new Set(input.participantIds)].filter((id) => id !== author.id);
  if (others.length === 0) throw badRequest("Choisissez au moins un destinataire.");
  const users = await prisma.user.findMany({ where: { id: { in: others } }, select: { id: true } });
  if (users.length !== others.length) throw badRequest("Destinataire introuvable.");
  const title = (input.title ?? "").trim();

  // Échange à deux sans titre : on reprend la conversation existante.
  if (others.length === 1 && !title) {
    const existing = await prisma.conversation.findFirst({
      where: {
        title: "",
        AND: [{ participants: { some: { userId: author.id } } }, { participants: { some: { userId: others[0] } } }, { participants: { every: { userId: { in: [author.id, others[0]] } } } }],
      },
      select: { id: true },
    });
    if (existing) {
      if (input.body?.trim()) await prisma.$transaction((tx) => postInTx(tx, author, existing.id, input.body!, null));
      return { conversationId: existing.id, created: false };
    }
  }

  const id = await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        title,
        createdById: author.id,
        participants: { create: [author.id, ...others].map((userId) => ({ userId, lastReadAt: userId === author.id ? new Date() : null })) },
      },
      select: { id: true },
    });
    if (input.body?.trim()) await postInTx(tx, author, conv.id, input.body, null);
    return conv.id;
  });
  return { conversationId: id, created: true };
}

export async function postMessage(author: User, conversationId: string, input: { body: string; replyToId?: string | null }): Promise<MessageDto> {
  await requireParticipant(author.id, conversationId);
  return prisma.$transaction((tx) => postInTx(tx, author, conversationId, input.body, input.replyToId ?? null));
}

export async function deleteMessage(userId: string, conversationId: string, messageId: string): Promise<MessageDto> {
  await requireParticipant(userId, conversationId);
  const m = await prisma.message.findFirst({ where: { id: messageId, conversationId }, select: { authorId: true, deletedAt: true } });
  if (!m) throw notFound("Message");
  if (m.authorId !== userId) throw forbidden();
  const row = await prisma.message.update({
    where: { id: messageId },
    data: m.deletedAt ? {} : { body: "", deletedAt: new Date() },
    include: MESSAGE_INCLUDE,
  });
  return toMessageDto(row);
}

/**
 * Vu / non vu. `read = true` : tout est lu (et les notifications MESSAGE de
 * la conversation aussi). `read = false` : la conversation redevient non lue
 * à partir du dernier message reçu.
 */
export async function setConversationRead(userId: string, conversationId: string, read: boolean): Promise<{ lastReadAt: string | null }> {
  await requireParticipant(userId, conversationId);
  let lastReadAt: Date | null;
  if (read) {
    lastReadAt = new Date();
    await prisma.notification.updateMany({
      where: { userId, type: "MESSAGE", href: `/messages/${conversationId}`, readAt: null },
      data: { readAt: lastReadAt },
    });
  } else {
    const lastReceived = await prisma.message.findFirst({
      where: { conversationId, deletedAt: null, NOT: { authorId: userId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lastReceived) throw new ApiError(409, "NOTHING_UNREAD", "Aucun message reçu dans cette conversation.");
    lastReadAt = new Date(lastReceived.createdAt.getTime() - 1);
  }
  await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId } }, data: { lastReadAt } });
  return { lastReadAt: lastReadAt?.toISOString() ?? null };
}

/** Quitter une conversation ; la dernière personne à partir la supprime. */
export async function leaveConversation(userId: string, conversationId: string): Promise<void> {
  await requireParticipant(userId, conversationId);
  await prisma.$transaction(async (tx) => {
    await tx.conversationParticipant.delete({ where: { conversationId_userId: { conversationId, userId } } });
    const left = await tx.conversationParticipant.count({ where: { conversationId } });
    if (left === 0) await tx.conversation.delete({ where: { id: conversationId } });
    await tx.notification.deleteMany({ where: { userId, type: "MESSAGE", href: `/messages/${conversationId}` } });
  });
}
