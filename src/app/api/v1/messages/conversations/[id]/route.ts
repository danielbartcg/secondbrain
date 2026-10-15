import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getConversation, leaveConversation } from "@/lib/messages";

type P = { id: string };

/** GET /api/v1/messages/conversations/:id[?before=<messageId>|?since=<ISO>] — fil de la conversation. */
export const GET = withUser<P>(async (req: NextRequest, { params, user }) => {
  const sp = req.nextUrl.searchParams;
  const before = sp.get("before")?.slice(0, 64) || undefined;
  const since = sp.get("since")?.slice(0, 40) || undefined;
  return json({ conversation: await getConversation(user.id, params.id, { before, since }) });
});

/** DELETE /api/v1/messages/conversations/:id — quitter la conversation. */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await leaveConversation(user.id, params.id);
  return json({ ok: true });
});
