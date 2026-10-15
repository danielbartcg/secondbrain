import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { createSession, toPublicUser, verifyPasswordOrDummy } from "@/lib/auth";
import { rateLimit, rateLimitAuth } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas";

/**
 * POST /api/v1/auth/login — ouvre une session.
 * Réponse : { user, token, expiresAt }. Le cookie `session` est posé pour le
 * web ; une application mobile conserve `token` et l'envoie en Bearer.
 * Limites : 10 essais / 15 min par IP **et** par compte ; la comparaison bcrypt
 * a toujours lieu (empreinte factice si le compte n'existe pas).
 */
export const POST = withPublic(async (req: NextRequest) => {
  const tooMany = () => new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  if (!rateLimitAuth(clientKey(req))) throw tooMany();
  const input = await parseBody(req, loginSchema);
  if (!rateLimit(`login:${input.email.toLowerCase()}`, 10, 15 * 60 * 1000)) throw tooMany();
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await verifyPasswordOrDummy(input.password, user?.passwordHash);
  if (!user || !ok) throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou mot de passe incorrect.");
  const session = await createSession(user.id, { label: input.client ?? "Web" });
  return json({ user: toPublicUser(user), token: session.token, expiresAt: session.expiresAt });
});
