import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { addMember } from "@/lib/projects";
import { createMemberSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/projects/:id/members — ajoute un membre (compte `userId` ou nom libre). Propriétaire uniquement. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createMemberSchema);
  return json({ project: await addMember(user.id, params.id, input) }, { status: 201 });
});
