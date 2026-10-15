import type { NextRequest } from "next/server";
import { badRequest, json, withUser } from "@/lib/api";
import { lookupUserByEmail } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/api";

/**
 * GET /api/v1/users/lookup?email=… — retrouve un compte par e-mail exact
 * (pour l'inviter dans une équipe projet). Réponse : { user: {id,name,email} | null }.
 * Limité à 60 recherches / 15 min / utilisateur pour éviter l'énumération.
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`lookup:${user.id}`, 60, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de recherches, réessayez plus tard.");
  const email = req.nextUrl.searchParams.get("email")?.trim();
  if (!email || !email.includes("@") || email.length > 254) throw badRequest("Paramètre email requis.");
  return json({ user: await lookupUserByEmail(email) });
});
