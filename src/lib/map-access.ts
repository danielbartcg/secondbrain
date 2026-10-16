import "server-only";
import type { MindMap, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, notFound } from "@/lib/api";
import { mapAccessOf, mapAllows, type MapAccess } from "@/lib/shared/map-access";
import { isAdminId } from "@/lib/template-access";

/**
 * Contrôle d'accès aux cartes mentales (anti-IDOR). Une carte est accessible
 * à son propriétaire et aux personnes avec qui elle est partagée
 * (`MindMapShare`, lecture ou écriture). Module sans dépendance métier : il
 * est utilisé par mindmaps.ts, projects.ts, tasks.ts, notes.ts, search.ts,
 * pins.ts et sync.ts sans créer de cycle d'import.
 */

export type { MapAccess } from "@/lib/shared/map-access";

type Db = Prisma.TransactionClient | PrismaClient;

/** Cartes que l'utilisateur peut lire (propriétaire ou partage) — hors cartes types. */
export function mapAccessWhere(userId: string): Prisma.MindMapWhereInput {
  return { isTemplate: false, OR: [{ ownerId: userId }, { shares: { some: { userId } } }] };
}

/** Cartes que l'utilisateur peut modifier (propriétaire ou partage en écriture). */
export function mapWriteWhere(userId: string): Prisma.MindMapWhereInput {
  return { isTemplate: false, OR: [{ ownerId: userId }, { shares: { some: { userId, permission: "WRITE" } } }] };
}

export const readOnlyMap = () => new ApiError(403, "READ_ONLY", "Cette carte vous est partagée en lecture seule.");
export const ownerOnly = () => new ApiError(403, "FORBIDDEN", "Seul le propriétaire de la carte peut faire cela.");

/**
 * Vérifie l'accès à une carte au niveau demandé : 404 si la carte n'est pas
 * accessible du tout, 403 si le droit est insuffisant.
 */
export async function requireMapAccess(userId: string, mapId: string, level: MapAccess, db: Db = prisma): Promise<{ map: MindMap; access: MapAccess }> {
  const row = await db.mindMap.findFirst({
    where: { id: mapId, ...mapAccessWhere(userId) },
    include: { shares: { where: { userId }, select: { permission: true } } },
  });
  if (!row) {
    // Carte type : les administrateurs ont tous les droits (Administration → Modèles).
    const tpl = await db.mindMap.findFirst({ where: { id: mapId, isTemplate: true } });
    if (tpl && (await isAdminId(userId, db))) return { map: tpl, access: "owner" };
    throw notFound("Carte");
  }
  const { shares, ...map } = row;
  const access = mapAccessOf(map.ownerId, userId, shares[0]?.permission) ?? "read";
  if (!mapAllows(access, level)) throw level === "owner" ? ownerOnly() : readOnlyMap();
  return { map, access };
}

/** Accès à la carte d'un nœud (404 si le nœud n'est pas sur une carte accessible). */
export async function requireNodeAccess(userId: string, nodeId: string, level: MapAccess, db: Db = prisma): Promise<{ mapId: string; access: MapAccess }> {
  const node = await db.mindNode.findFirst({ where: { id: nodeId }, select: { mapId: true } });
  if (!node) throw notFound("Nœud");
  const { access } = await requireMapAccess(userId, node.mapId, level, db);
  return { mapId: node.mapId, access };
}
