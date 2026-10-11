import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteActivity, updateActivity } from "@/lib/projects";
import { updateActivitySchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/activities/:id — met à jour une activité ; renvoie le projet. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateActivitySchema);
  return json({ project: await updateActivity(user.id, params.id, input) });
});

/** DELETE /api/v1/activities/:id — supprime l'activité et ses tâches. */
export const DELETE = withUser<P>(async (_req, { params, user }) =>
  json({ project: await deleteActivity(user.id, params.id) }),
);
