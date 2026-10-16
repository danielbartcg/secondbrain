import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createProject, deleteProject, listProjects } from "@/lib/projects";
import { applyProjectTemplate } from "@/lib/templates";
import { createProjectFromTemplateSchema, createProjectSchema } from "@/lib/schemas";

/** GET /api/v1/projects — projets de l'utilisateur, avec avancement agrégé. */
export const GET = withUser(async (_req, { user }) => json({ projects: await listProjects(user.id) }));

/** POST /api/v1/projects — crée un projet ; `templateId` : à partir d'un projet type. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, createProjectSchema.merge(createProjectFromTemplateSchema));
  const project = await createProject(user.id, input);
  if (!input.templateId) return json({ project }, { status: 201 });
  try {
    return json({ project: await applyProjectTemplate(user.id, project.id, input.templateId) }, { status: 201 });
  } catch (e) {
    // Modèle introuvable : pas de projet à moitié créé.
    await deleteProject(user.id, project.id).catch(() => {});
    throw e;
  }
});
