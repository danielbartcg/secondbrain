import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { getResurface, reviewResurface } from "@/lib/resurface";
import { resurfaceReviewSchema } from "@/lib/schemas-features";

/** GET /api/v1/me/resurface — notes à relire aujourd'hui (`{ items }`, 3 au plus). */
export const GET = withUser(async (_req, { user }) => json({ items: await getResurface(user.id) }));

/** POST /api/v1/me/resurface — `{ ref, answer: remember | again | archive }` ; renvoie `{ items }` à jour. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const { ref, answer } = await parseBody(req, resurfaceReviewSchema);
  return json({ items: await reviewResurface(user.id, ref, answer) });
});
