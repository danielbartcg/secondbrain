import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteProject, getProject, updateProject } from "@/lib/projects";
import { updateProjectSchema } from "@/lib/schemas";

type P = { id: string };

/** GET /api/v1/projects/:id — projet complet : étapes > activités > tâches. */
export const GET = withUser<P>(async (_req, { params, user }) => json({ project: await getProject(user.id, params.id) }));

/** PATCH /api/v1/projects/:id */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateProjectSchema);
  return json({ project: await updateProject(user.id, params.id, input) });
});

/** DELETE /api/v1/projects/:id */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await deleteProject(user.id, params.id);
  return json({ ok: true });
});
