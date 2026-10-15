import type { NextRequest } from "next/server";
import { ApiError, json, parseBody, withUser } from "@/lib/api";
import { listMapShares, shareMap } from "@/lib/map-shares";
import { createMapShareSchema } from "@/lib/schemas-map-shares";
import { rateLimit } from "@/lib/rate-limit";

type P = { id: string };

/** GET /api/v1/mindmaps/:id/shares — personnes avec qui la carte est partagée (propriétaire seulement). */
export const GET = withUser<P>(async (_req, { params, user }) => json(await listMapShares(user.id, params.id)));

/**
 * POST /api/v1/mindmaps/:id/shares — `{ userId | email, permission: READ|WRITE }` :
 * partage avec un compte existant (ou change son droit). Propriétaire seulement ;
 * limité à 60 partages / 15 min / utilisateur (l'e-mail permettrait l'énumération).
 */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  if (!rateLimit(`map-share:${user.id}`, 60, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de partages, réessayez plus tard.");
  const input = await parseBody(req, createMapShareSchema);
  return json(await shareMap(user.id, params.id, input), { status: 201 });
});
