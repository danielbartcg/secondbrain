import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createMindMap, deleteMindMap, listMindMaps } from "@/lib/mindmaps";
import { applyMapTemplate } from "@/lib/templates";
import { createMindMapFromTemplateSchema, createMindMapSchema } from "@/lib/schemas";

/** GET /api/v1/mindmaps — cartes de l'utilisateur. */
export const GET = withUser(async (_req, { user }) => json({ mindmaps: await listMindMaps(user.id) }));

/** POST /api/v1/mindmaps — crée une carte (avec sa racine) ; `templateId` : à partir d'une carte type. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createMindMapSchema.merge(createMindMapFromTemplateSchema));
  const map = await createMindMap(user.id, input.title);
  if (!input.templateId) return json({ mindmap: map }, { status: 201 });
  try {
    return json({ mindmap: await applyMapTemplate(user.id, map.id, input.templateId) }, { status: 201 });
  } catch (e) {
    await deleteMindMap(user.id, map.id).catch(() => {});
    throw e;
  }
});
