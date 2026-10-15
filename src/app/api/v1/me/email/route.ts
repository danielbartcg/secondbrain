import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { changeEmailSchema } from "@/lib/schemas";
import { changeEmail } from "@/lib/account-email";

/**
 * POST /api/v1/me/email — `{ email, currentPassword }` : change l'adresse du
 * compte (non validée ensuite ; lien de validation envoyé si les e-mails sont configurés).
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`email-change:${user.id}`, 10, 60 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const input = await parseBody(req, changeEmailSchema);
  return json(await changeEmail(user, input.email, input.currentPassword));
});
