import "server-only";
import type { PinKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";
import { projectAccessWhere } from "@/lib/projects";
import { mapAccessWhere } from "@/lib/map-access";

/**
 * Ordre personnel des projets et des cartes mentales (glisser-déposer, « Trier
 * A → Z », « Trier par mise à jour ») : appliqué aux listes et aux épingles du
 * menu. Les éléments sans rang suivent (plus récents d'abord, côté écran).
 */

export const MAX_ORDERED = 2000;

export async function getItemOrder(userId: string, kind: PinKind): Promise<string[]> {
  const rows = await prisma.itemOrder.findMany({ where: { userId, kind }, orderBy: { rank: "asc" }, select: { targetId: true } });
  return rows.map((r) => r.targetId);
}

/** Remplace l'ordre : `ids` (éléments accessibles uniquement, les autres sont ignorés). */
export async function setItemOrder(userId: string, kind: PinKind, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_ORDERED) throw badRequest(`${MAX_ORDERED} éléments au plus.`);
  const accessible =
    kind === "PROJECT"
      ? await prisma.project.findMany({ where: { id: { in: unique }, ...projectAccessWhere(userId) }, select: { id: true } })
      : await prisma.mindMap.findMany({ where: { AND: [{ id: { in: unique } }, mapAccessWhere(userId)] }, select: { id: true } });
  const ok = new Set(accessible.map((x) => x.id));
  const kept = unique.filter((id) => ok.has(id));
  await prisma.$transaction([
    prisma.itemOrder.deleteMany({ where: { userId, kind } }),
    prisma.itemOrder.createMany({ data: kept.map((targetId, rank) => ({ userId, kind, targetId, rank })) }),
  ]);
  return kept;
}
