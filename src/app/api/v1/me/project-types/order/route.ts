import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { reorderProjectTypes } from "@/lib/project-types";
import { projectTypeOrderSchema } from "@/lib/schemas-project-types";

/** PUT /api/v1/me/project-types/order — `{ ids }` (tous mes types, dans le nouvel ordre) → `{ projectTypes }`. */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const { ids } = await parseBody(req, projectTypeOrderSchema);
  return json({ projectTypes: await reorderProjectTypes(user.id, ids) });
});
