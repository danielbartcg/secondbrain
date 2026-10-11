import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { removeMember, updateMember } from "@/lib/projects";
import { updateMemberSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/members/:id — nom, e-mail, rôle, couleur. Propriétaire uniquement. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateMemberSchema);
  return json({ project: await updateMember(user.id, params.id, input) });
});

/** DELETE /api/v1/members/:id — retire le membre (ses tâches sont désaffectées). */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ project: await removeMember(user.id, params.id) }));
