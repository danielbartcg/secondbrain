import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createProjectTemplate } from "@/lib/templates";
import { createProjectTemplateSchema } from "@/lib/schemas";

/** POST /api/v1/admin/templates/projects — `{ name, fromProjectId? }` : nouveau projet type (administrateurs). */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createProjectTemplateSchema);
  return json({ project: await createProjectTemplate(user, input) }, { status: 201 });
});
