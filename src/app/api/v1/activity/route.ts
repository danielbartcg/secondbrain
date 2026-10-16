import { json, withUser } from "@/lib/api";
import { getActivity } from "@/lib/activity";

/**
 * GET /api/v1/activity?period=7d|week|last_week|month|…&from=AAAA-MM-JJ&to=AAAA-MM-JJ&projectId=&mapId=&all=1
 * Rapport d'activité consolidé (tâches, cartes, réunions, risques, livrables,
 * documents) sur une fenêtre libre. `all=1` : toute la plateforme (administrateurs).
 */
export const GET = withUser(async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  const s = (k: string) => sp.get(k)?.slice(0, 64) || null;
  return json({ activity: await getActivity(user, { period: s("period"), from: s("from"), to: s("to"), projectId: s("projectId"), mapId: s("mapId"), all: sp.get("all") === "1" }) });
});
