import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { assertProtocol, push } from "@/lib/sync";
import { syncPushSchema } from "@/lib/schemas";

/**
 * POST /api/v1/sync/push — `{ ops: [{ opId, entity, id, op, fields?, base? }] }` (500 max),
 * rejouées dans l'ordre ; résultat par opération (applied / conflict / rejected).
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  assertProtocol(req.headers.get("x-sync-protocol"));
  const { ops } = await parseBody(req, syncPushSchema);
  return json(await push(user.id, ops));
});
