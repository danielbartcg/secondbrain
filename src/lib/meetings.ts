import "server-only";
import { Prisma, type ApprovalDecision, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";
import { requireProjectAccess } from "@/lib/projects";
import { notify } from "@/lib/notifications";
import { htmlToText, sanitizeNotes } from "@/lib/sanitize";

/**
 * Réunions de projet et validation des comptes-rendus.
 *
 *  - Lecture : membres du projet (requireProjectAccess).
 *  - Écriture (titre, date, lieu, participants, validateurs, compte-rendu) :
 *    le rédacteur (créateur) ou le propriétaire du projet.
 *  - Validation : chaque validateur (membre rattaché à un compte) valide ou
 *    refuse (motif obligatoire) ; le rédacteur est notifié (MEETING_DECISION).
 *  - Toute modification du compte-rendu remet toutes les décisions « en
 *    attente » et notifie les validateurs (MEETING_REVIEW, regroupée par réunion).
 */

export type MeetingStatus = "draft" | "no_review" | "pending" | "approved" | "rejected";

export type MeetingDto = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  location: string;
  authorId: string | null;
  authorName: string;
  /** HTML assaini. */
  minutes: string;
  minutesUpdatedAt: string | null;
  participants: { memberId: string; name: string; userId: string | null; avatarUrl: string | null }[];
  approvers: { memberId: string; userId: string | null; name: string; avatarUrl: string | null; decision: ApprovalDecision; comment: string; decidedAt: string | null }[];
  status: MeetingStatus;
  /** Je peux modifier (rédacteur ou propriétaire du projet). */
  canEdit: boolean;
  /** Ma décision si je suis validateur, sinon null. */
  myDecision: ApprovalDecision | null;
  createdAt: string;
  updatedAt: string;
};

const INCLUDE = {
  author: { select: { id: true, name: true } },
  participants: { include: { member: { select: { id: true, name: true, userId: true, user: { select: { avatarUrl: true } } } } } },
  approvers: { include: { member: { select: { id: true, name: true, userId: true, user: { select: { avatarUrl: true } } } } } },
} satisfies Prisma.MeetingInclude;
type Row = Prisma.MeetingGetPayload<{ include: typeof INCLUDE }>;

const hasContent = (html: string) => /<img\b/i.test(html) || htmlToText(html).length > 0;

/** Statut d'un compte-rendu (aussi utilisé par le connecteur MCP). */
export function meetingStatus(m: { minutes: string; approvers: { decision: string }[] }): MeetingStatus {
  if (!hasContent(m.minutes)) return "draft";
  if (m.approvers.length === 0) return "no_review";
  if (m.approvers.some((a) => a.decision === "REJECTED")) return "rejected";
  if (m.approvers.every((a) => a.decision === "APPROVED")) return "approved";
  return "pending";
}

function toDto(m: Row, userId: string, projectOwnerId: string): MeetingDto {
  return {
    id: m.id,
    projectId: m.projectId,
    title: m.title,
    date: m.date.toISOString(),
    location: m.location,
    authorId: m.authorId,
    authorName: m.author?.name ?? "Compte supprimé",
    minutes: sanitizeNotes(m.minutes),
    minutesUpdatedAt: m.minutesUpdatedAt?.toISOString() ?? null,
    participants: m.participants
      .map((p) => ({ memberId: p.member.id, name: p.member.name, userId: p.member.userId, avatarUrl: p.member.user?.avatarUrl ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    approvers: m.approvers
      .map((a) => ({
        memberId: a.member.id,
        userId: a.member.userId,
        name: a.member.name,
        avatarUrl: a.member.user?.avatarUrl ?? null,
        decision: a.decision,
        comment: a.comment,
        decidedAt: a.decidedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    status: meetingStatus(m),
    canEdit: m.authorId === userId || projectOwnerId === userId,
    myDecision: m.approvers.find((a) => a.member.userId === userId)?.decision ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const meetingHref = (projectId: string, meetingId: string) => `/projects/${projectId}?meeting=${meetingId}#reunions`;

export async function listMeetings(userId: string, projectId: string): Promise<MeetingDto[]> {
  const access = await requireProjectAccess(userId, projectId);
  const rows = await prisma.meeting.findMany({ where: { projectId }, include: INCLUDE, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  return rows.map((m) => toDto(m, userId, access.ownerId));
}

async function checkMembers(db: Prisma.TransactionClient, projectId: string, ids: string[], label: string, needAccount = false) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const found = await db.projectMember.findMany({ where: { id: { in: unique }, projectId }, select: { id: true, userId: true } });
  if (found.length !== unique.length) throw badRequest(`${label} : membre introuvable dans ce projet.`);
  if (needAccount && found.some((m) => !m.userId)) throw badRequest("Un validateur doit être un membre rattaché à un compte (il doit pouvoir se connecter pour valider).");
  return unique;
}

/** Notifie les validateurs (hors auteur de l'action) qu'un compte-rendu attend leur validation. */
async function notifyReviewers(tx: Prisma.TransactionClient, actor: User, meeting: { id: string; projectId: string; title: string }, memberIds: string[], reason: "new" | "changed") {
  if (!memberIds.length) return;
  const members = await tx.projectMember.findMany({ where: { id: { in: memberIds } }, select: { userId: true } });
  await notify(
    tx,
    members.map((m) => ({
      userId: m.userId,
      type: "MEETING_REVIEW" as const,
      title: reason === "new" ? `${actor.name} vous demande de valider le compte-rendu « ${meeting.title} »` : `Compte-rendu « ${meeting.title} » modifié : à revalider`,
      body: reason === "changed" ? `${actor.name} a modifié le compte-rendu ; les validations précédentes sont annulées.` : "",
      href: meetingHref(meeting.projectId, meeting.id),
      projectId: meeting.projectId,
      actorId: actor.id,
      actorName: actor.name,
    })),
  );
}

export type MeetingInput = { title?: string; date?: string; location?: string; participantIds?: string[]; approverIds?: string[]; minutes?: string };

export async function createMeeting(user: User, projectId: string, input: MeetingInput & { title: string; date: string }): Promise<MeetingDto[]> {
  await requireProjectAccess(user.id, projectId);
  await prisma.$transaction(async (tx) => {
    const participantIds = await checkMembers(tx, projectId, input.participantIds ?? [], "Participants");
    const approverIds = await checkMembers(tx, projectId, input.approverIds ?? [], "Validateurs", true);
    const minutes = sanitizeNotes(input.minutes ?? "");
    const m = await tx.meeting.create({
      data: {
        projectId,
        title: input.title.trim(),
        date: new Date(input.date),
        location: (input.location ?? "").trim(),
        authorId: user.id,
        minutes,
        minutesUpdatedAt: hasContent(minutes) ? new Date() : null,
        participants: { create: participantIds.map((memberId) => ({ memberId })) },
        approvers: { create: approverIds.map((memberId) => ({ memberId })) },
      },
    });
    if (hasContent(minutes)) await notifyReviewers(tx, user, m, approverIds, "new");
  });
  return listMeetings(user.id, projectId);
}

async function editableMeeting(userId: string, meetingId: string) {
  const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true, projectId: true, authorId: true, title: true } });
  if (!m) throw notFound("Réunion");
  const access = await requireProjectAccess(userId, m.projectId).catch(() => {
    throw notFound("Réunion");
  });
  return { meeting: m, access, canEdit: m.authorId === userId || access.isOwner };
}

export async function updateMeeting(user: User, meetingId: string, input: MeetingInput): Promise<MeetingDto[]> {
  const { meeting, canEdit } = await editableMeeting(user.id, meetingId);
  if (!canEdit) throw new ApiError(403, "FORBIDDEN", "Seul le rédacteur du compte-rendu (ou le propriétaire du projet) peut le modifier.");
  await prisma.$transaction(async (tx) => {
    // Verrou de ligne : deux sauvegardes simultanées du compte-rendu ne s'entrelacent pas.
    await tx.$queryRaw`SELECT "id" FROM "Meeting" WHERE "id" = ${meetingId} FOR UPDATE`;
    const current = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { approvers: true } });
    const data: Prisma.MeetingUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.date !== undefined) data.date = new Date(input.date);
    if (input.location !== undefined) data.location = input.location.trim();
    let minutesChanged = false;
    if (input.minutes !== undefined) {
      const minutes = sanitizeNotes(input.minutes);
      if (minutes !== current.minutes) {
        minutesChanged = true;
        data.minutes = minutes;
        data.minutesUpdatedAt = new Date();
      }
    }
    if (input.participantIds !== undefined) {
      const ids = await checkMembers(tx, meeting.projectId, input.participantIds, "Participants");
      await tx.meetingParticipant.deleteMany({ where: { meetingId, memberId: { notIn: ids } } });
      await tx.meetingParticipant.createMany({ data: ids.map((memberId) => ({ meetingId, memberId })), skipDuplicates: true });
    }
    let addedApprovers: string[] = [];
    if (input.approverIds !== undefined) {
      const ids = await checkMembers(tx, meeting.projectId, input.approverIds, "Validateurs", true);
      await tx.meetingApprover.deleteMany({ where: { meetingId, memberId: { notIn: ids } } });
      addedApprovers = ids.filter((id) => !current.approvers.some((a) => a.memberId === id));
      await tx.meetingApprover.createMany({ data: addedApprovers.map((memberId) => ({ meetingId, memberId })), skipDuplicates: true });
    }
    const updated = await tx.meeting.update({ where: { id: meetingId }, data });
    const hasMinutes = hasContent(updated.minutes);
    if (minutesChanged) {
      // Toute modification du compte-rendu annule les validations / refus déjà donnés.
      await tx.meetingApprover.updateMany({ where: { meetingId }, data: { decision: "PENDING", comment: "", decidedAt: null } });
      if (hasMinutes) {
        const all = (await tx.meetingApprover.findMany({ where: { meetingId }, select: { memberId: true } })).map((a) => a.memberId);
        const hadContent = hasContent(current.minutes);
        await notifyReviewers(tx, user, updated, all, hadContent ? "changed" : "new");
      }
    } else if (addedApprovers.length && hasMinutes) {
      await notifyReviewers(tx, user, updated, addedApprovers, "new");
    }
  });
  return listMeetings(user.id, meeting.projectId);
}

export async function deleteMeeting(user: User, meetingId: string): Promise<MeetingDto[]> {
  const { meeting, canEdit } = await editableMeeting(user.id, meetingId);
  if (!canEdit) throw forbidden();
  await prisma.$transaction(async (tx) => {
    await tx.meeting.delete({ where: { id: meetingId } });
    await tx.notification.deleteMany({ where: { href: meetingHref(meeting.projectId, meetingId) } });
  });
  return listMeetings(user.id, meeting.projectId);
}

/** Décision d'un validateur : APPROVED, ou REJECTED avec motif. Le rédacteur est notifié. */
export async function decideMeeting(user: User, meetingId: string, decision: "APPROVED" | "REJECTED", comment: string): Promise<MeetingDto[]> {
  const { meeting } = await editableMeeting(user.id, meetingId);
  const text = comment.trim();
  if (decision === "REJECTED" && !text) throw badRequest("Expliquez pourquoi vous refusez le compte-rendu.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Meeting" WHERE "id" = ${meetingId} FOR UPDATE`;
    const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { approvers: { include: { member: { select: { userId: true } } } } } });
    const mine = m.approvers.find((a) => a.member.userId === user.id);
    if (!mine) throw new ApiError(403, "FORBIDDEN", "Vous n'êtes pas validateur de ce compte-rendu.");
    if (!hasContent(m.minutes)) throw badRequest("Le compte-rendu est vide : rien à valider pour l'instant.");
    await tx.meetingApprover.update({
      where: { meetingId_memberId: { meetingId, memberId: mine.memberId } },
      data: { decision, comment: text.slice(0, 5000), decidedAt: new Date() },
    });
    if (m.authorId) {
      await notify(tx, [
        {
          userId: m.authorId,
          type: "MEETING_DECISION",
          title: decision === "APPROVED" ? `${user.name} a validé le compte-rendu « ${m.title} »` : `${user.name} a refusé le compte-rendu « ${m.title} »`,
          body: decision === "REJECTED" ? `Motif : ${text}` : text,
          href: meetingHref(m.projectId, m.id),
          projectId: m.projectId,
          actorId: user.id,
          actorName: user.name,
        },
      ]);
    }
  });
  return listMeetings(user.id, meeting.projectId);
}
