import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { assertProtocol, pull, snapshot } from "@/lib/sync";

/**
 * GET /api/v1/sync/pull — applications hors ligne (en-tête `X-Sync-Protocol` obligatoire).
 *  - sans `cursor` (ou 0) : instantané complet du périmètre ;
 *  - `?cursor=N[&limit=1000]` : changements depuis N ;
 *  - `?project=<id>` ou `?map=<id>` : instantané d'un élément entré dans le périmètre.
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  assertProtocol(req.headers.get("x-sync-protocol"));
  const sp = req.nextUrl.searchParams;
  const project = sp.get("project");
  const map = sp.get("map");
  if (project || map) return json(await snapshot(user.id, { projectId: project ?? undefined, mapId: map ?? undefined }));
  const cursor = Number(sp.get("cursor") ?? "0");
  if (!Number.isFinite(cursor) || cursor <= 0) return json(await snapshot(user.id));
  const limit = Math.min(5000, Math.max(1, Number(sp.get("limit") ?? "1000") || 1000));
  return json(await pull(user.id, Math.floor(cursor), limit));
});
