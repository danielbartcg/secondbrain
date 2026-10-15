import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { leaveSharedMap, unshareMap, updateMapShare } from "@/lib/map-shares";
import { updateMapShareSchema } from "@/lib/schemas-map-shares";

type P = { id: string; userId: string };

/** PATCH /api/v1/mindmaps/:id/shares/:userId — `{ permission }` (propriétaire seulement). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateMapShareSchema);
  return json(await updateMapShare(user.id, params.id, params.userId, input));
});

/**
 * DELETE /api/v1/mindmaps/:id/shares/:userId — le propriétaire retire l'accès
 * d'une personne (renvoie les partages), ou la personne elle-même quitte la
 * carte (`:userId` = soi ; renvoie `{ ok: true }`).
 */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  if (params.userId === user.id) {
    await leaveSharedMap(user.id, params.id);
    return json({ ok: true });
  }
  return json(await unshareMap(user.id, params.id, params.userId));
});
