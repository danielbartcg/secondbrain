import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getMapAt } from "@/lib/time-travel";
import { timeTravelAtSchema } from "@/lib/schemas-features";

type P = { id: string };

/** GET /api/v1/mindmaps/:id/time-travel?at= — état de la carte à cette date (droit de lecture), `{ state }`. */
export const GET = withUser<P>(async (req: NextRequest, { params, user }) => {
  const at = timeTravelAtSchema.parse(req.nextUrl.searchParams.get("at") ?? new Date().toISOString());
  return json({ state: await getMapAt(user.id, params.id, at) });
});
