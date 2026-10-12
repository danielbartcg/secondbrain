import { json, withUser } from "@/lib/api";
import { markAllRead } from "@/lib/notifications";

/** POST /api/v1/notifications/read-all — marque toutes mes notifications comme lues. */
export const POST = withUser(async (_req, { user }) => {
  await markAllRead(user.id);
  return json({ ok: true });
});
