import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteNotification, setNotificationRead } from "@/lib/notifications";
import { updateNotificationSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/notifications/:id — `{ read: true|false }` (lue / non lue). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateNotificationSchema);
  return json({ notification: await setNotificationRead(user.id, params.id, input.read) });
});

/** DELETE /api/v1/notifications/:id */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await deleteNotification(user.id, params.id);
  return json({ ok: true });
});
