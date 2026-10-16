import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { applyMapTemplate } from "@/lib/templates";
import { applyTemplateSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/mindmaps/:id/apply-template — `{ templateId }` : remplit une carte qui n'a que sa racine à partir d'une carte type (écriture ; 409 sinon). */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { templateId } = await parseBody(req, applyTemplateSchema);
  return json({ mindmap: await applyMapTemplate(user.id, params.id, templateId) });
});
