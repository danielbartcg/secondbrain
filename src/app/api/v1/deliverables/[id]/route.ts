import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteDeliverable, updateDeliverable } from "@/lib/projects";
import { updateDeliverableSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/deliverables/:id — statut, responsable, dates, étape, ordre ; renvoie le projet. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateDeliverableSchema);
  return json({ project: await updateDeliverable(user.id, params.id, input) });
});

/** DELETE /api/v1/deliverables/:id — les documents rattachés restent dans le projet. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ project: await deleteDeliverable(user.id, params.id) }));
