import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteProjectType, renameProjectType } from "@/lib/project-types";
import { projectTypeNameSchema } from "@/lib/schemas-project-types";

type P = { id: string };

/** PATCH /api/v1/me/project-types/:id — `{ name }` → `{ projectTypes }`. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { name } = await parseBody(req, projectTypeNameSchema);
  return json({ projectTypes: await renameProjectType(user.id, params.id, name) });
});

/** DELETE /api/v1/me/project-types/:id — ses projets redeviennent sans type → `{ projectTypes }`. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ projectTypes: await deleteProjectType(user.id, params.id) }));
