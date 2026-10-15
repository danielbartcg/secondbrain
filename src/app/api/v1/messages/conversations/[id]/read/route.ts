import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { setConversationRead } from "@/lib/messages";
import { conversationReadSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/messages/conversations/:id/read — `{ read }` : marquer lue / non lue. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { read } = await parseBody(req, conversationReadSchema);
  return json(await setConversationRead(user.id, params.id, read));
});
