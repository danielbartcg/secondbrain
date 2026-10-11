import "server-only";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { deleteDocumentFile, resolveDocumentPath, saveDocumentFile } from "@/lib/uploads";
import {
  mutateProject,
  projectAccessWhere,
  requireProjectAccess,
  toDocumentDto,
  type DocumentDto,
  type ProjectDto,
} from "@/lib/projects";
import type { UpdateDocumentInput } from "@/lib/schemas";

/**
 * Documents de projet : fichiers stockés sous DATA_DIR/documents, métadonnées
 * en base. Un document peut matérialiser un livrable (`deliverableId`) : il
 * est alors téléchargeable depuis ce livrable.
 */

async function documentProjectId(userId: string, documentId: string): Promise<string> {
  const d = await prisma.document.findFirst({ where: { id: documentId, project: projectAccessWhere(userId) }, select: { projectId: true } });
  if (!d) throw notFound("Document");
  return d.projectId;
}

export async function listDocuments(userId: string, projectId: string): Promise<DocumentDto[]> {
  await requireProjectAccess(userId, projectId);
  const rows = await prisma.document.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });
  return rows.map(toDocumentDto);
}

export async function uploadDocument(
  userId: string,
  projectId: string,
  file: File,
  options: { name?: string; deliverableId?: string | null },
): Promise<ProjectDto> {
  await requireProjectAccess(userId, projectId);
  if (options.deliverableId) {
    const d = await prisma.deliverable.findFirst({ where: { id: options.deliverableId, projectId }, select: { id: true } });
    if (!d) throw badRequest("Ce livrable n'appartient pas au projet.");
  }
  const originalName = (file.name || "document").slice(0, 200);
  const { storagePath, mimeType } = await saveDocumentFile(file, projectId);
  try {
    return await mutateProject(projectId, async (tx) => {
      await tx.document.create({
        data: {
          projectId,
          deliverableId: options.deliverableId ?? null,
          uploadedById: userId,
          name: (options.name?.trim() || originalName).slice(0, 200),
          originalName,
          mimeType,
          size: file.size,
          storagePath,
        },
      });
    });
  } catch (e) {
    await deleteDocumentFile(storagePath).catch(() => {});
    throw e;
  }
}

export async function updateDocument(userId: string, documentId: string, input: UpdateDocumentInput): Promise<ProjectDto> {
  const projectId = await documentProjectId(userId, documentId);
  return mutateProject(projectId, async (tx) => {
    if (input.deliverableId) {
      const d = await tx.deliverable.findFirst({ where: { id: input.deliverableId, projectId }, select: { id: true } });
      if (!d) throw badRequest("Ce livrable n'appartient pas au projet.");
    }
    await tx.document.update({ where: { id: documentId }, data: { name: input.name, deliverableId: input.deliverableId } });
  });
}

export async function deleteDocument(userId: string, documentId: string): Promise<ProjectDto> {
  const projectId = await documentProjectId(userId, documentId);
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { storagePath: true, uploadedById: true, project: { select: { ownerId: true } } } });
  if (doc.uploadedById !== userId && doc.project.ownerId !== userId) throw forbidden();
  const project = await mutateProject(projectId, async (tx) => {
    await tx.document.delete({ where: { id: documentId } });
  });
  await deleteDocumentFile(doc.storagePath).catch(() => {});
  return project;
}

/** Chemin disque et métadonnées pour le téléchargement (accès vérifié). */
export async function documentForDownload(
  userId: string,
  documentId: string,
): Promise<{ path: string; mimeType: string; fileName: string; size: number }> {
  const d = await prisma.document.findFirst({ where: { id: documentId, project: projectAccessWhere(userId) } });
  if (!d) throw notFound("Document");
  const filePath = resolveDocumentPath(d.storagePath);
  if (!filePath) throw notFound("Document");
  return { path: filePath, mimeType: d.mimeType, fileName: d.originalName, size: d.size };
}
