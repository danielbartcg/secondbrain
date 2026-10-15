import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { createSession, hashPassword, registrationAllowed, toPublicUser } from "@/lib/auth";
import { rateLimitAuth } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/schemas";
import { displayName } from "@/lib/users";
import { isSuperAdmin } from "@/lib/roles";
import { sendWelcomeEmail } from "@/lib/account-email";

/** POST /api/v1/auth/register — crée un compte et ouvre une session. */
export const POST = withPublic(async (req: NextRequest) => {
  if (!registrationAllowed()) throw new ApiError(403, "REGISTRATION_CLOSED", "Les inscriptions sont fermées.");
  if (!rateLimitAuth(clientKey(req))) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const input = await parseBody(req, registerSchema);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  // Le compte super administrateur ne se crée que par scripts/create-user.ts.
  if (existing || isSuperAdmin({ email: input.email })) throw new ApiError(409, "EMAIL_TAKEN", "Un compte existe déjà avec cet e-mail.");
  const firstName = input.firstName ?? input.name ?? "";
  const lastName = input.lastName ?? "";
  const user = await prisma.user.create({
    data: { email: input.email, firstName, lastName, name: displayName(firstName, lastName, input.email), passwordHash: await hashPassword(input.password) },
  });
  // E-mail de bienvenue + lien de validation (si l'envoi d'e-mails est configuré ; en arrière-plan).
  sendWelcomeEmail(user);
  const session = await createSession(user.id, { label: input.client ?? "Web" });
  return json({ user: toPublicUser(user), token: session.token, expiresAt: session.expiresAt }, { status: 201 });
});
