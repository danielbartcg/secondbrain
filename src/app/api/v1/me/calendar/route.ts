import { json, withUser } from "@/lib/api";
import { createCalendarFeed, deleteCalendarFeed, getCalendarFeed } from "@/lib/calendar-feed";

/** GET /api/v1/me/calendar — état de mon flux iCal (`{ feed: { active, createdAt, lastUsedAt } }`). */
export const GET = withUser(async (_req, { user }) => json({ feed: await getCalendarFeed(user.id) }));

/** POST /api/v1/me/calendar — crée ou régénère l'adresse (l'ancienne cesse de fonctionner) ; `{ path, feed }`, montré une seule fois. */
export const POST = withUser(async (_req, { user }) => json(await createCalendarFeed(user.id), { status: 201 }));

/** DELETE /api/v1/me/calendar — révoque le flux. */
export const DELETE = withUser(async (_req, { user }) => {
  await deleteCalendarFeed(user.id);
  return json({ ok: true });
});
