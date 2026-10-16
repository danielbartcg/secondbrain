import { json, withUser } from "@/lib/api";
import { listMapEvents } from "@/lib/map-events";

type P = { id: string };

/** GET /api/v1/mindmaps/:id/history?nodeId=&limit= — piste d'audit de la carte (plus récent d'abord, 300 par défaut, 1000 max). */
export const GET = withUser<P>(async (req, { params, user }) => {
  const sp = req.nextUrl.searchParams;
  const nodeId = sp.get("nodeId")?.slice(0, 64) || undefined;
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") ?? "300") || 300));
  return json({ events: await listMapEvents(user.id, params.id, { nodeId, limit }) });
});
