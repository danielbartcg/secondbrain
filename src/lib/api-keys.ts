import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";

/**
 * Clés d'accès personnelles (Préférences → Connecteur Claude / MCP).
 *
 * Une clé agit au nom de son propriétaire (connecteur MCP), en lecture seule ou en lecture et écriture (`canWrite`).
 * Format : `sb_` + 43 caractères base64url (256 bits). Seule l'empreinte
 * SHA-256 est stockée ; la clé en clair n'est affichée qu'à sa création.
 */

export const API_KEY_PREFIX = "sb_";
const MAX_KEYS = 10;

export type ApiKeyDto = { id: string; name: string; prefix: string; canWrite: boolean; createdAt: string; lastUsedAt: string | null };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function toDto(k: { id: string; name: string; prefix: string; canWrite: boolean; createdAt: Date; lastUsedAt: Date | null }): ApiKeyDto {
  return { id: k.id, name: k.name, prefix: k.prefix, canWrite: k.canWrite, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null };
}

export async function listApiKeys(userId: string): Promise<ApiKeyDto[]> {
  const rows = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toDto);
}

export async function createApiKey(userId: string, name: string, canWrite = true): Promise<{ key: string; apiKey: ApiKeyDto }> {
  if ((await prisma.apiKey.count({ where: { userId } })) >= MAX_KEYS) throw badRequest(`${MAX_KEYS} clés au maximum : révoquez-en une d'abord.`);
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  const row = await prisma.apiKey.create({ data: { userId, name: name.trim() || "Clé", prefix: key.slice(0, 10), tokenHash: sha256(key), canWrite } });
  return { key, apiKey: toDto(row) };
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  const r = await prisma.apiKey.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw notFound("Clé");
}

/** Utilisateur d'une clé valide et son droit d'écriture, ou null. Met à jour « dernière utilisation » (au plus une fois par minute). */
export async function authenticateApiKeyScope(key: string | null | undefined): Promise<{ user: User; canWrite: boolean } | null> {
  if (!key || !key.startsWith(API_KEY_PREFIX) || key.length > 100) return null;
  const row = await prisma.apiKey.findUnique({ where: { tokenHash: sha256(key) }, include: { user: true } });
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { user: row.user, canWrite: row.canWrite };
}

export async function authenticateApiKey(key: string | null | undefined): Promise<User | null> {
  return (await authenticateApiKeyScope(key))?.user ?? null;
}
