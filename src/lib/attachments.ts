import "server-only";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";
import { taskEditWhere } from "@/lib/projects";
import { canConsultTask } from "@/lib/tasks";
import { requireMapAccess } from "@/lib/map-access";
import { deleteDocumentFile, resolveDocumentPath, saveDocumentFile } from "@/lib/uploads";
import { actorDisplayName, recordTaskEvents } from "@/lib/task-events";
import { recordMapEvents } from "@/lib/map-events";

/**
 * Pièces jointes des commentaires de tâche et des nœuds de carte mentale.
 * Mêmes garanties que les documents de projet : allowlist des types (HTML
 * compris), 25 Mo, nom aléatoire, chemin borné, téléchargement authentifié
 * (`/api/v1/attachments/:id/download`, CSP « sandbox »). Droits :
 *   - commentaire : lecture = fiche de la tâche ; ajout = auteur du
 *     commentaire (tâche modifiable) ; retrait = auteur du commentaire,
 *     déposant ou propriétaire du projet / de la tâche ;
 *   - nœud : lecture = carte lisible ; ajout / retrait = carte modifiable.
 * Chaque ajout / retrait est tracé (piste d'audit de la tâche ou de la carte).
 */

export const MAX_ATTACHMENTS_PER_TARGET = 20;

export type AttachmentDto = {
  id: string;
  commentId: string | null;
  nodeId: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedByName: string | null;
  createdAt: string;
  /** Téléchargement authentifié ; `?inline=1` pour un aperçu. */
  url: string;
};

type Row = { id: string; commentId: string | null; nodeId: string | null; fileName: string; mimeType: string; size: number; createdAt: Date; uploadedBy: { name: string } | null };
const SELECT = { id: true, commentId: true, nodeId: true, fileName: true, mimeType: true, size: true, createdAt: true, uploadedBy: { select: { name: true } } } as const;

const toDto = (a: Row): AttachmentDto => ({
  id: a.id,
  commentId: a.commentId,
  nodeId: a.nodeId,
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.size,
  uploadedByName: a.uploadedBy?.name ?? null,
  createdAt: a.createdAt.toISOString(),
  url: `/api/v1/attachments/${a.id}/download`,
});

const cleanName = (name: string) => (name.replace(/[\\/\r\n\t]+/g, "_").trim() || "fichier").slice(0, 200);

// --- Commentaires ---------------------------------------------------------------

/** Pièces jointes de tous les commentaires d'une tâche (même accès que la fiche). */
export async function listTaskAttachments(userId: string, taskId: string): Promise<AttachmentDto[]> {
  const canEdit = (await prisma.task.count({ where: { id: taskId, ...(await taskEditWhere(userId)) } })) > 0;
  if (!canEdit && !(await canConsultTask(userId, taskId))) throw notFound("Tâche");
  const rows = await prisma.attachment.findMany({ where: { comment: { taskId } }, orderBy: { createdAt: "asc" }, select: SELECT });
  return rows.map(toDto);
}

/** Joint un fichier à mon commentaire ; renvoie les pièces jointes de la tâche. */
export async function addCommentAttachment(userId: string, commentId: string, file: File): Promise<AttachmentDto[]> {
  const c = await prisma.taskComment.findFirst({
    where: { id: commentId, task: await taskEditWhere(userId) },
    select: { id: true, authorId: true, taskId: true, task: { select: { projectId: true } }, _count: { select: { attachments: true } } },
  });
  if (!c) throw notFound("Commentaire");
  if (c.authorId !== userId) throw new ApiError(403, "FORBIDDEN", "Seul l'auteur du commentaire peut y joindre des fichiers.");
  if (c._count.attachments >= MAX_ATTACHMENTS_PER_TARGET) throw badRequest(`${MAX_ATTACHMENTS_PER_TARGET} pièces jointes au plus par commentaire.`);
  const { storagePath, mimeType } = await saveDocumentFile(file, c.task.projectId ?? `task_${c.taskId}`);
  const fileName = cleanName(file.name);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.attachment.create({ data: { commentId, uploadedById: userId, fileName, mimeType, size: file.size, storagePath } });
      const actor = await actorDisplayName(tx, userId);
      await recordTaskEvents(tx, [{ taskId: c.taskId, actorId: userId, actorName: actor, kind: "comment", newValue: fileName, message: `${actor} a joint « ${fileName} » à un commentaire` }]);
    });
  } catch (e) {
    await deleteDocumentFile(storagePath);
    throw e;
  }
  return listTaskAttachments(userId, c.taskId);
}

// --- Nœuds de carte -------------------------------------------------------------

async function nodeOf(mapId: string, nodeId: string) {
  const n = await prisma.mindNode.findFirst({ where: { id: nodeId, mapId }, select: { id: true, title: true, _count: { select: { attachments: true } } } });
  if (!n) throw notFound("Nœud");
  return n;
}

export async function listNodeAttachments(userId: string, mapId: string, nodeId: string): Promise<AttachmentDto[]> {
  await requireMapAccess(userId, mapId, "read");
  await nodeOf(mapId, nodeId);
  const rows = await prisma.attachment.findMany({ where: { nodeId }, orderBy: { createdAt: "asc" }, select: SELECT });
  return rows.map(toDto);
}

export async function addNodeAttachment(userId: string, mapId: string, nodeId: string, file: File): Promise<AttachmentDto[]> {
  await requireMapAccess(userId, mapId, "write");
  const n = await nodeOf(mapId, nodeId);
  if (n._count.attachments >= MAX_ATTACHMENTS_PER_TARGET) throw badRequest(`${MAX_ATTACHMENTS_PER_TARGET} pièces jointes au plus par nœud.`);
  const { storagePath, mimeType } = await saveDocumentFile(file, `map_${mapId}`);
  const fileName = cleanName(file.name);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.attachment.create({ data: { nodeId, uploadedById: userId, fileName, mimeType, size: file.size, storagePath } });
      const actor = await actorDisplayName(tx, userId);
      await recordMapEvents(tx, [{ mapId, nodeId, nodeTitle: n.title, actorId: userId, actorName: actor, kind: "node_attachment", newValue: fileName, message: `${actor} a joint « ${fileName} » au nœud « ${n.title} »` }]);
    });
  } catch (e) {
    await deleteDocumentFile(storagePath);
    throw e;
  }
  return listNodeAttachments(userId, mapId, nodeId);
}

// --- Retrait et téléchargement -----------------------------------------------------

/** Pièce jointe accessible en lecture (sinon 404), avec ce qu'il faut pour les droits. */
async function readable(userId: string, id: string) {
  const a = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      size: true,
      storagePath: true,
      uploadedById: true,
      commentId: true,
      nodeId: true,
      comment: { select: { authorId: true, taskId: true, task: { select: { ownerId: true, project: { select: { ownerId: true } } } } } },
      node: { select: { mapId: true, title: true } },
    },
  });
  if (!a) throw notFound("Pièce jointe");
  if (a.comment) {
    const canEdit = (await prisma.task.count({ where: { id: a.comment.taskId, ...(await taskEditWhere(userId)) } })) > 0;
    if (!canEdit && !(await canConsultTask(userId, a.comment.taskId))) throw notFound("Pièce jointe");
    return { a, canEdit };
  }
  if (a.node) {
    try {
      const { access } = await requireMapAccess(userId, a.node.mapId, "read");
      return { a, canEdit: access !== "read" };
    } catch {
      throw notFound("Pièce jointe");
    }
  }
  throw notFound("Pièce jointe");
}

export async function attachmentForDownload(userId: string, id: string): Promise<{ path: string; fileName: string; mimeType: string }> {
  const { a } = await readable(userId, id);
  const p = resolveDocumentPath(a.storagePath);
  if (!p) throw notFound("Pièce jointe");
  return { path: p, fileName: a.fileName, mimeType: a.mimeType };
}

/** Retire une pièce jointe ; renvoie la liste à jour (de la tâche ou du nœud). */
export async function deleteAttachment(userId: string, id: string): Promise<AttachmentDto[]> {
  const { a, canEdit } = await readable(userId, id);
  if (!canEdit) throw forbidden();
  if (a.comment) {
    const owner = a.comment.task.project?.ownerId ?? a.comment.task.ownerId;
    if (a.uploadedById !== userId && a.comment.authorId !== userId && owner !== userId) throw forbidden();
  }
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id } });
    const actor = await actorDisplayName(tx, userId);
    if (a.comment) await recordTaskEvents(tx, [{ taskId: a.comment.taskId, actorId: userId, actorName: actor, kind: "comment", oldValue: a.fileName, message: `${actor} a retiré la pièce jointe « ${a.fileName} »` }]);
    if (a.node) await recordMapEvents(tx, [{ mapId: a.node.mapId, nodeId: a.nodeId, nodeTitle: a.node.title, actorId: userId, actorName: actor, kind: "node_attachment", oldValue: a.fileName, message: `${actor} a retiré « ${a.fileName} » du nœud « ${a.node.title} »` }]);
  });
  await deleteDocumentFile(a.storagePath);
  if (a.comment) return listTaskAttachments(userId, a.comment.taskId);
  return listNodeAttachments(userId, a.node!.mapId, a.nodeId!);
}

/** Fichiers à effacer après la suppression (en cascade) de commentaires ou de nœuds. */
export async function attachmentPaths(where: { commentId?: string; nodeIds?: string[] }): Promise<string[]> {
  const rows = await prisma.attachment.findMany({
    where: where.commentId ? { OR: [{ commentId: where.commentId }, { comment: { parentId: where.commentId } }] } : { nodeId: { in: where.nodeIds ?? [] } },
    select: { storagePath: true },
  });
  return rows.map((r) => r.storagePath);
}
