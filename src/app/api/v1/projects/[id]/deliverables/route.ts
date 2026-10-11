import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createDeliverable } from "@/lib/projects";
import { createDeliverableSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/projects/:id/deliverables — ajoute un livrable ; renvoie le projet. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createDeliverableSchema);
  return json({ project: await createDeliverable(user.id, params.id, input) }, { status: 201 });
});
