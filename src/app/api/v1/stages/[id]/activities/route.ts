import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createActivity } from "@/lib/projects";
import { createActivitySchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/stages/:id/activities — ajoute une activité à l'étape ; renvoie le projet. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createActivitySchema);
  return json({ project: await createActivity(user.id, params.id, input) }, { status: 201 });
});
