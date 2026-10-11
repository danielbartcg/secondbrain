import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { addComment } from "@/lib/tasks";
import { createCommentSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/tasks/:id/comments — `{ body }` avec mentions `@[Nom](memberId)` ; renvoie la fiche tâche. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createCommentSchema);
  return json({ task: await addComment(user.id, params.id, input.body) }, { status: 201 });
});
