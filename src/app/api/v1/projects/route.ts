import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createProject, listProjects } from "@/lib/projects";
import { createProjectSchema } from "@/lib/schemas";

/** GET /api/v1/projects — projets de l'utilisateur, avec avancement agrégé. */
export const GET = withUser(async (_req, { user }) => json({ projects: await listProjects(user.id) }));

/** POST /api/v1/projects — crée un projet. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createProjectSchema);
  return json({ project: await createProject(user.id, input) }, { status: 201 });
});
