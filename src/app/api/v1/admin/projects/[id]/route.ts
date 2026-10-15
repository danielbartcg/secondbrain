import { json, withUser } from "@/lib/api";
import { getProjectAdmin } from "@/lib/projects";
import { requireAdmin } from "@/lib/users";

type P = { id: string };

/** GET /api/v1/admin/projects/:id — un projet quelconque, complet (lecture seule). */
export const GET = withUser<P>(async (_req, { params, user }) => {
  requireAdmin(user);
  return json({ project: await getProjectAdmin(user, params.id) });
});
