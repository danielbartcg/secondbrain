import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { assignProjectType } from "@/lib/project-types";
import { projectTypeAssignSchema } from "@/lib/schemas-project-types";

/** PUT /api/v1/me/project-types/assign — `{ projectId, typeId | null }` → `{ projectTypes }` (projet accessible, type à moi). */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const { projectId, typeId } = await parseBody(req, projectTypeAssignSchema);
  return json({ projectTypes: await assignProjectType(user.id, projectId, typeId) });
});
