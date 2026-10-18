import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteBaseline, getBaseline, renameBaseline } from "@/lib/baselines";
import { baselineNameSchema } from "@/lib/schemas-features";

type P = { id: string; baselineId: string };

/** GET /api/v1/projects/:id/baselines/:baselineId — instantané complet (`{ baseline }`). */
export const GET = withUser<P>(async (_req: NextRequest, { params, user }) => {
  return json({ baseline: await getBaseline(user.id, params.id, params.baselineId) });
});

/** PATCH /api/v1/projects/:id/baselines/:baselineId — renomme (auteur ou propriétaire du projet). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { name } = await parseBody(req, baselineNameSchema);
  return json({ baseline: await renameBaseline(user.id, params.id, params.baselineId, name) });
});

/** DELETE /api/v1/projects/:id/baselines/:baselineId — supprime (auteur ou propriétaire du projet). */
export const DELETE = withUser<P>(async (_req: NextRequest, { params, user }) => {
  await deleteBaseline(user.id, params.id, params.baselineId);
  return json({ ok: true });
});
