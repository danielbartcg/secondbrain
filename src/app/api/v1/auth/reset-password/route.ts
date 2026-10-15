import type { NextRequest } from "next/server";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { rateLimitAuth } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/lib/schemas";
import { resetPassword } from "@/lib/account-email";

/** POST /api/v1/auth/reset-password — `{ token, password, confirmPassword? }` ; ferme toutes les sessions. */
export const POST = withPublic(async (req: NextRequest) => {
  if (!rateLimitAuth(clientKey(req))) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const input = await parseBody(req, resetPasswordSchema);
  await resetPassword(input.token, input.password);
  return json({ ok: true });
});
