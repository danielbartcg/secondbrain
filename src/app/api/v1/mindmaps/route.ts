import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createMindMap, listMindMaps } from "@/lib/mindmaps";
import { createMindMapSchema } from "@/lib/schemas";

/** GET /api/v1/mindmaps — cartes de l'utilisateur. */
export const GET = withUser(async (_req, { user }) => json({ mindmaps: await listMindMaps(user.id) }));

/** POST /api/v1/mindmaps — crée une carte (avec sa racine). */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createMindMapSchema);
  return json({ mindmap: await createMindMap(user.id, input.title) }, { status: 201 });
});
