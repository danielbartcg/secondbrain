import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createMapTemplate } from "@/lib/templates";
import { createMapTemplateSchema } from "@/lib/schemas";

/** POST /api/v1/admin/templates/maps — `{ title, fromMapId? }` : nouvelle carte type (administrateurs). */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createMapTemplateSchema);
  return json({ mindmap: await createMapTemplate(user, input) }, { status: 201 });
});
