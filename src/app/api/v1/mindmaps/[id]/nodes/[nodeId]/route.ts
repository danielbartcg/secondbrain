import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteNode, updateNode } from "@/lib/mindmaps";
import { updateNodeSchema } from "@/lib/schemas";

type P = { id: string; nodeId: string };

/** PATCH /api/v1/mindmaps/:id/nodes/:nodeId — titre, notes, couleur, repli. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateNodeSchema);
  return json({ node: await updateNode(user.id, params.id, params.nodeId, input) });
});

/** DELETE /api/v1/mindmaps/:id/nodes/:nodeId — supprime le nœud et sa branche. */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await deleteNode(user.id, params.id, params.nodeId);
  return json({ ok: true });
});
