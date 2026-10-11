import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteTask, updateTask } from "@/lib/projects";
import { getTaskDetail } from "@/lib/tasks";
import { updateTaskSchema } from "@/lib/schemas";

type P = { id: string };

/** GET /api/v1/tasks/:id — fiche tâche : projet, étape, activité, responsable, équipe, commentaires. */
export const GET = withUser<P>(async (_req, { params, user }) => json({ task: await getTaskDetail(user.id, params.id) }));

/**
 * PATCH /api/v1/tasks/:id — avancement, statut, nom, description, dates,
 * responsable (`assigneeId`), ordre, déplacement (activityId / stageId).
 * Renvoie le projet recalculé.
 */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateTaskSchema);
  return json({ project: await updateTask(user.id, params.id, input) });
});

/** DELETE /api/v1/tasks/:id */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ project: await deleteTask(user.id, params.id) }));
