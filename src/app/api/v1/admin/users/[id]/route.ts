import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { requireAdmin, updateUserAdmin } from "@/lib/users";
import { adminUpdateUserSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/admin/users/:id — `{ role?, managerId? }` ; renvoie la liste à jour. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  requireAdmin(user);
  const input = await parseBody(req, adminUpdateUserSchema);
  return json({ users: await updateUserAdmin(user, params.id, input) });
});
