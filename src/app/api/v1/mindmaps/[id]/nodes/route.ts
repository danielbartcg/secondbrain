import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createNode } from "@/lib/mindmaps";
import { createNodeSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/mindmaps/:id/nodes — ajoute un nœud sous `parentId`. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createNodeSchema);
  return json({ node: await createNode(user.id, params.id, input) }, { status: 201 });
});
