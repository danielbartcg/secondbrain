import { json, withUser } from "@/lib/api";
import { listUsersAdmin, requireAdmin } from "@/lib/users";

/** GET /api/v1/admin/users — tous les comptes (administrateurs uniquement). */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ users: await listUsersAdmin(user) });
});
