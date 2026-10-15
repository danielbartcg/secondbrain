import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { createUserAdmin, listUsersAdmin, requireAdmin } from "@/lib/users";
import { adminCreateUserSchema } from "@/lib/schemas-admin";
import { rateLimit } from "@/lib/rate-limit";

/** GET /api/v1/admin/users — tous les comptes (administrateurs uniquement). */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ users: await listUsersAdmin(user) });
});

/**
 * POST /api/v1/admin/users — crée un compte avec un mot de passe imposé
 * `{ email, firstName, lastName, password, role?, managerId? }` ; 201 `{ users }`.
 * 409 `EMAIL_TAKEN` si l'adresse existe (ou est celle du super administrateur).
 * Limite : 30 créations / heure / administrateur.
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  requireAdmin(user);
  if (!rateLimit(`admin-create-user:${user.id}`, 30, 60 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de créations de comptes, réessayez plus tard.");
  const input = await parseBody(req, adminCreateUserSchema);
  return json({ users: await createUserAdmin(user, input) }, { status: 201 });
});
