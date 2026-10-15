import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { RATE_LIMITED_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { assertProtocol, push } from "@/lib/sync";
import { syncPushSchema } from "@/lib/schemas";

/**
 * POST /api/v1/sync/push — `{ ops: [{ opId, entity, id, op, fields?, base? }] }` (500 max),
 * rejouées dans l'ordre ; résultat par opération (applied / conflict / rejected).
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`sync-push:${user.id}`, 300, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", RATE_LIMITED_MESSAGE);
  assertProtocol(req.headers.get("x-sync-protocol"));
  const { ops } = await parseBody(req, syncPushSchema);
  return json(await push(user.id, ops));
});
