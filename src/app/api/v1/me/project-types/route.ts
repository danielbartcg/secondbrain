import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createProjectType, listProjectTypes } from "@/lib/project-types";
import { projectTypeNameSchema } from "@/lib/schemas-project-types";

/** GET /api/v1/me/project-types — `{ projectTypes: { types: { id, name }[], assignments: { [projectId]: typeId } } }`. */
export const GET = withUser(async (_req, { user }) => json({ projectTypes: await listProjectTypes(user.id) }));

/** POST /api/v1/me/project-types — `{ name }` → `201 { projectTypes }` (50 types max, nom unique). */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const { name } = await parseBody(req, projectTypeNameSchema);
  return json({ projectTypes: await createProjectType(user.id, name) }, { status: 201 });
});
