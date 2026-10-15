import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { requireAdmin, setUserPasswordAdmin } from "@/lib/users";
import { adminSetPasswordSchema } from "@/lib/schemas-admin";
import { rateLimit } from "@/lib/rate-limit";

type P = { id: string };

/**
 * POST /api/v1/admin/users/:id/password — `{ password }` : mot de passe imposé
 * par un administrateur ; toutes les sessions de la personne sont fermées.
 * Réponse `{ ok: true }`. Limite : 30 / heure / administrateur.
 */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  requireAdmin(user);
  if (!rateLimit(`admin-set-password:${user.id}`, 30, 60 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de réinitialisations, réessayez plus tard.");
  const { password } = await parseBody(req, adminSetPasswordSchema);
  await setUserPasswordAdmin(user, params.id, password);
  return json({ ok: true });
});
