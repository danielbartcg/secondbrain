import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { addWorkSession } from "@/lib/tasks";
import { createWorkSessionSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/tasks/:id/sessions — `{ date: "AAAA-MM-JJ" }` planifie une session de travail ; renvoie les sessions de la tâche. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createWorkSessionSchema);
  return json({ sessions: await addWorkSession(user.id, params.id, input.date) }, { status: 201 });
});
