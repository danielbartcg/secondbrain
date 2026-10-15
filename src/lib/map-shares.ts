import "server-only";
import type { MapPermission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { requireMapAccess } from "@/lib/map-access";
import { notify } from "@/lib/notifications";
import { MAP_PERMISSION_LABEL } from "@/lib/shared/map-access";
import type { CreateMapShareInput, UpdateMapShareInput } from "@/lib/schemas-map-shares";

/**
 * Partage des cartes mentales. Seul le propriétaire gère les partages
 * (liste, ajout, changement de droit, retrait) ; un destinataire peut
 * seulement quitter une carte qu'on lui a partagée. Le destinataire d'un
 * nouveau partage (ou d'un changement de droit) est notifié (`MAP_SHARED`).
 */

export type MapShareDto = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  permission: MapPermission;
  createdAt: string;
};

export type MapSharesDto = { shares: MapShareDto[] };

/** Nombre maximal de personnes par carte (borne de sécurité). */
const MAX_SHARES = 200;

export async function listMapShares(userId: string, mapId: string): Promise<MapSharesDto> {
  await requireMapAccess(userId, mapId, "owner");
  const rows = await prisma.mindMapShare.findMany({
    where: { mapId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  return {
    shares: rows.map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      email: r.user.email,
      avatarUrl: r.user.avatarUrl,
      permission: r.permission,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function shareTitle(actor: string, mapTitle: string, permission: MapPermission, updated: boolean) {
  const what = MAP_PERMISSION_LABEL[permission].toLowerCase();
  return updated
    ? `${actor} a modifié votre accès à la carte « ${mapTitle} » (${what})`
    : `${actor} a partagé la carte « ${mapTitle} » avec vous (${what})`;
}

/** Partage (ou met à jour le droit) avec un compte existant, désigné par id ou e-mail exact. */
export async function shareMap(ownerId: string, mapId: string, input: CreateMapShareInput): Promise<MapSharesDto> {
  const { map } = await requireMapAccess(ownerId, mapId, "owner");
  const target = input.userId
    ? await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    : await prisma.user.findUnique({ where: { email: input.email! }, select: { id: true } });
  if (!target) throw notFound("Utilisateur");
  if (target.id === ownerId) throw badRequest("Vous êtes déjà propriétaire de cette carte.");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MindMap" WHERE "id" = ${mapId} FOR UPDATE`;
    const existing = await tx.mindMapShare.findUnique({ where: { mapId_userId: { mapId, userId: target.id } } });
    if (!existing && (await tx.mindMapShare.count({ where: { mapId } })) >= MAX_SHARES) {
      throw new ApiError(409, "TOO_MANY_SHARES", `Une carte peut être partagée avec ${MAX_SHARES} personnes au plus.`);
    }
    if (existing?.permission === input.permission) return; // rien ne change : pas de nouvelle notification
    await tx.mindMapShare.upsert({
      where: { mapId_userId: { mapId, userId: target.id } },
      create: { mapId, userId: target.id, permission: input.permission, sharedById: ownerId },
      update: { permission: input.permission },
    });
    const actor = (await tx.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? "Quelqu'un";
    await notify(tx, [
      {
        userId: target.id,
        type: "MAP_SHARED",
        title: shareTitle(actor, map.title, input.permission, Boolean(existing)),
        href: `/mindmaps/${mapId}`,
        actorId: ownerId,
        actorName: actor,
      },
    ]);
  });
  return listMapShares(ownerId, mapId);
}

/** Change le droit d'une personne (propriétaire seulement). */
export async function updateMapShare(ownerId: string, mapId: string, userId: string, input: UpdateMapShareInput): Promise<MapSharesDto> {
  await requireMapAccess(ownerId, mapId, "owner");
  const existing = await prisma.mindMapShare.findUnique({ where: { mapId_userId: { mapId, userId } }, select: { userId: true } });
  if (!existing) throw notFound("Partage");
  return shareMap(ownerId, mapId, { userId, permission: input.permission });
}

/** Retire l'accès d'une personne (propriétaire seulement). */
export async function unshareMap(ownerId: string, mapId: string, userId: string): Promise<MapSharesDto> {
  await requireMapAccess(ownerId, mapId, "owner");
  const removed = await prisma.mindMapShare.deleteMany({ where: { mapId, userId } });
  if (removed.count === 0) throw notFound("Partage");
  await prisma.pin.deleteMany({ where: { userId, kind: "MINDMAP", targetId: mapId } });
  return listMapShares(ownerId, mapId);
}

/** Un destinataire quitte une carte qu'on lui a partagée. */
export async function leaveSharedMap(userId: string, mapId: string): Promise<void> {
  const removed = await prisma.mindMapShare.deleteMany({ where: { mapId, userId } });
  if (removed.count === 0) throw notFound("Carte");
  await prisma.pin.deleteMany({ where: { userId, kind: "MINDMAP", targetId: mapId } });
}
