import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteMindMap, getMindMap, updateMindMap } from "@/lib/mindmaps";
import { updateMindMapSchema } from "@/lib/schemas";

type P = { id: string };

/** GET /api/v1/mindmaps/:id — carte complète (tous les nœuds). */
export const GET = withUser<P>(async (_req, { params, user }) => json({ mindmap: await getMindMap(user.id, params.id) }));

/** PATCH /api/v1/mindmaps/:id — renomme la carte. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateMindMapSchema);
  await updateMindMap(user.id, params.id, input);
  return json({ mindmap: await getMindMap(user.id, params.id) });
});

/** DELETE /api/v1/mindmaps/:id */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await deleteMindMap(user.id, params.id);
  return json({ ok: true });
});
