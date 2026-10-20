import "server-only";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { MEDIA_IMAGE_RE } from "@/lib/shared/icons";

/**
 * Icônes personnalisées d'un utilisateur : images téléversées (/uploads,
 * allowlist des images, pas de SVG) gardées dans sa bibliothèque pour être
 * réutilisées sur ses projets et ses cartes. Personnel.
 */

export const MAX_USER_ICONS = 200;
export type UserIconDto = { id: string; url: string; createdAt: string };

export async function listUserIcons(userId: string): Promise<UserIconDto[]> {
  const rows = await prisma.userIcon.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, url: r.url, createdAt: r.createdAt.toISOString() }));
}

export async function addUserIcon(userId: string, url: string): Promise<UserIconDto[]> {
  if (!MEDIA_IMAGE_RE.test(url)) throw badRequest("Image invalide (PNG, JPEG, GIF ou WebP téléversée).");
  if ((await prisma.userIcon.count({ where: { userId } })) >= MAX_USER_ICONS) throw badRequest(`${MAX_USER_ICONS} icônes personnalisées au plus.`);
  await prisma.userIcon.upsert({ where: { userId_url: { userId, url } }, create: { userId, url }, update: {} });
  return listUserIcons(userId);
}

/** Retire l'icône de ma bibliothèque (les projets / cartes qui l'utilisent la gardent). */
export async function removeUserIcon(userId: string, id: string): Promise<UserIconDto[]> {
  const removed = await prisma.userIcon.deleteMany({ where: { id, userId } });
  if (!removed.count) throw notFound("Icône");
  return listUserIcons(userId);
}
