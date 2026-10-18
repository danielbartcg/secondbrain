import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getProjectStale } from "@/lib/freshness";
import { staleDaysSchema } from "@/lib/schemas-features";

type P = { id: string };

/**
 * GET /api/v1/projects/:id/stale?days= — tâches ouvertes du projet sans
 * activité depuis `days` jours (`{ tasks: { [taskId]: lastActivityAt } }`) et
 * dernière activité du projet.
 */
export const GET = withUser<P>(async (req: NextRequest, { params, user }) => {
  const q = req.nextUrl.searchParams.get("days");
  const days = q ? staleDaysSchema.parse(q) : user.staleDays;
  return json({ stale: await getProjectStale(user.id, params.id, days) });
});
