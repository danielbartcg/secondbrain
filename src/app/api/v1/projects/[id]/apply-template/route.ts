import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { applyProjectTemplate } from "@/lib/templates";
import { applyTemplateSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/projects/:id/apply-template — `{ templateId }` : initialise un projet vide à partir d'un projet type (propriétaire ; 409 si non vide). */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { templateId } = await parseBody(req, applyTemplateSchema);
  return json({ project: await applyProjectTemplate(user.id, params.id, templateId) });
});
