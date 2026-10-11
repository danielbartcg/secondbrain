import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { moveNode } from "@/lib/mindmaps";
import { moveNodeSchema } from "@/lib/schemas";

type P = { id: string; nodeId: string };

/** POST /api/v1/mindmaps/:id/nodes/:nodeId/move — change de parent et/ou de position. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, moveNodeSchema);
  return json({ node: await moveNode(user.id, params.id, params.nodeId, input) });
});
