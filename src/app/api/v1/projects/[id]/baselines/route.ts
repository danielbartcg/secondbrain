import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createBaseline, listBaselines } from "@/lib/baselines";
import { baselineNameSchema } from "@/lib/schemas-features";

type P = { id: string };

/** GET /api/v1/projects/:id/baselines — plannings de référence du projet, plus récents d'abord (`{ baselines }`). */
export const GET = withUser<P>(async (_req: NextRequest, { params, user }) => {
  return json({ baselines: await listBaselines(user.id, params.id) });
});

/** POST /api/v1/projects/:id/baselines — fige le planning actuel sous un nom ; renvoie `{ baseline }` (avec `data`). */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { name } = await parseBody(req, baselineNameSchema);
  return json({ baseline: await createBaseline(user.id, params.id, name) }, { status: 201 });
});
