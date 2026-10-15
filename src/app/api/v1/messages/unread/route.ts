import { json, withUser } from "@/lib/api";
import { unreadMessagesCount } from "@/lib/messages";

/** GET /api/v1/messages/unread — `{ count }` : messages non lus (badge du menu). */
export const GET = withUser(async (_req, { user }) => json({ count: await unreadMessagesCount(user.id) }));
