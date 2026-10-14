import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { getSessionToken, hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { changePasswordSchema } from "@/lib/schemas";

/**
 * POST /api/v1/me/password — `{ currentPassword, newPassword, confirmPassword? }`.
 * Vérifie le mot de passe actuel (10 essais / 15 min / compte), enregistre le
 * nouveau (bcrypt) et ferme les **autres** sessions (autres navigateurs,
 * applications) ; la session courante reste ouverte.
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`password:${user.id}`, 10, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const input = await parseBody(req, changePasswordSchema);
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, "INVALID_CREDENTIALS", "Mot de passe actuel incorrect.");
  }
  const token = await getSessionToken();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
    prisma.session.deleteMany({ where: { userId: user.id, ...(token ? { NOT: { token } } : {}) } }),
  ]);
  return json({ ok: true });
});
