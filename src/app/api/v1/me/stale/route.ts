import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getStaleOverview } from "@/lib/freshness";
import { staleDaysSchema } from "@/lib/schemas-features";

/**
 * GET /api/v1/me/stale?days= — fraîcheur : mes tâches ouvertes et mes projets
 * actifs sans activité depuis `days` jours (défaut : ma préférence `staleDays`).
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const q = req.nextUrl.searchParams.get("days");
  const days = q ? staleDaysSchema.parse(q) : user.staleDays;
  return json({ stale: await getStaleOverview(user.id, days) });
});
