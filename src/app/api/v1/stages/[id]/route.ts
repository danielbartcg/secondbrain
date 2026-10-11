import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteStage, updateStage } from "@/lib/projects";
import { updateStageSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/stages/:id — met à jour une étape (nom, dates, ordre) ; renvoie le projet. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateStageSchema);
  return json({ project: await updateStage(user.id, params.id, input) });
});

/** DELETE /api/v1/stages/:id — supprime l'étape (activités et tâches comprises). */
export const DELETE = withUser<P>(async (_req, { params, user }) =>
  json({ project: await deleteStage(user.id, params.id) }),
);
