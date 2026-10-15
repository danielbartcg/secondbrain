import type { NextRequest } from "next/server";
import { ApiError, clientKey, json, parseBody, withPublic } from "@/lib/api";
import { rateLimitAuth } from "@/lib/rate-limit";
import { verifyEmailSchema } from "@/lib/schemas";
import { verifyEmail } from "@/lib/account-email";

/** POST /api/v1/auth/verify-email — `{ token }` (lien reçu par e-mail) → `{ email }`. */
export const POST = withPublic(async (req: NextRequest) => {
  if (!rateLimitAuth(clientKey(req))) throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez plus tard.");
  const { token } = await parseBody(req, verifyEmailSchema);
  return json(await verifyEmail(token));
});
