import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getProjectAt } from "@/lib/time-travel";
import { timeTravelAtSchema } from "@/lib/schemas-features";

type P = { id: string };

/** GET /api/v1/projects/:id/time-travel?at= — état du projet à cette date (pistes d'audit rembobinées), `{ state }`. */
export const GET = withUser<P>(async (req: NextRequest, { params, user }) => {
  const at = timeTravelAtSchema.parse(req.nextUrl.searchParams.get("at") ?? new Date().toISOString());
  return json({ state: await getProjectAt(user.id, params.id, at) });
});
