import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { createSession, toPublicUser, verifyPassword } from "@/lib/auth";
import { rateLimitAuth } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas";

/**
 * POST /api/v1/auth/login — ouvre une session.
 * Réponse : { user, token, expiresAt }. Le cookie `session` est posé pour le
 * web ; une application mobile conserve `token` et l'envoie en Bearer.
 */
export const POST = withPublic(async (req: NextRequest) => {
  if (!rateLimitAuth(clientKey(req))) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const input = await parseBody(req, loginSchema);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou mot de passe incorrect.");
  const session = await createSession(user.id, { label: input.client ?? "Web" });
  return json({ user: toPublicUser(user), token: session.token, expiresAt: session.expiresAt });
});
