import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createStage } from "@/lib/projects";
import { createStageSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/projects/:id/stages — ajoute une étape ; renvoie le projet à jour. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createStageSchema);
  return json({ project: await createStage(user.id, params.id, input) }, { status: 201 });
});
