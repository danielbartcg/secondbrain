import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { rateLimit } from "@/lib/rate-limit";
import { createApiKeySchema } from "@/lib/schemas";

/** GET /api/v1/me/api-keys — mes clés d'accès (sans la clé elle-même). */
export const GET = withUser(async (_req, { user }) => json({ apiKeys: await listApiKeys(user.id) }));

/** POST /api/v1/me/api-keys — `{ name }` → `{ key, apiKey }` : la clé en clair n'est renvoyée qu'ici. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`api-key:${user.id}`, 20, 60 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de créations de clés, réessayez plus tard.");
  const { name, canWrite } = await parseBody(req, createApiKeySchema);
  return json(await createApiKey(user.id, name, canWrite), { status: 201 });
});
