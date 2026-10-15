import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { postMessage } from "@/lib/messages";
import { postMessageSchema } from "@/lib/schemas";
import { requireMessageRate } from "@/lib/messages-rate";

type P = { id: string };

/** POST /api/v1/messages/conversations/:id/messages — `{ body (HTML), replyToId? }`. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  requireMessageRate(user.id);
  const input = await parseBody(req, postMessageSchema);
  return json({ message: await postMessage(user, params.id, input) }, { status: 201 });
});
