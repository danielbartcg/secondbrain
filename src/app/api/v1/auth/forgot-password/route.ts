import type { NextRequest } from "next/server";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { rateLimit, rateLimitAuth } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/schemas";
import { requestPasswordReset } from "@/lib/account-email";

/**
 * POST /api/v1/auth/forgot-password — `{ email }`. Réponse identique que le
 * compte existe ou non ; 503 si l'envoi d'e-mails n'est pas configuré.
 */
export const POST = withPublic(async (req: NextRequest) => {
  if (!rateLimitAuth(clientKey(req))) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const { email } = await parseBody(req, forgotPasswordSchema);
  // 3 demandes / heure / adresse : pas de bombardement de la boîte d'un tiers.
  if (rateLimit(`forgot:${email}`, 3, 60 * 60 * 1000)) await requestPasswordReset(email);
  return json({ ok: true });
});
