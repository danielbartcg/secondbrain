import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { listNotifications } from "@/lib/notifications";

/** GET /api/v1/notifications?limit=30&unread=1 — mes notifications (récentes d'abord) et le nombre de non lues. */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "30");
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  return json(await listNotifications(user.id, { limit: Number.isFinite(limit) ? limit : 30, unreadOnly }));
});
