import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createConversation, listConversations } from "@/lib/messages";
import { createConversationSchema } from "@/lib/schemas";
import { requireMessageRate } from "@/lib/messages-rate";

/** GET /api/v1/messages/conversations — mes conversations, la plus récente d'abord. */
export const GET = withUser(async (_req, { user }) => json({ conversations: await listConversations(user.id) }));

/**
 * POST /api/v1/messages/conversations — `{ participantIds, title?, body? }`.
 * À deux et sans titre, la conversation existante est reprise (201 si créée, 200 sinon).
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  requireMessageRate(user.id);
  const input = await parseBody(req, createConversationSchema);
  const r = await createConversation(user, input);
  return json(r, { status: r.created ? 201 : 200 });
});
