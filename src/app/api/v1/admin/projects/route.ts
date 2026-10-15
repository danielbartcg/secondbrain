import { json, withUser } from "@/lib/api";
import { listAllProjectsAdmin } from "@/lib/projects";
import { requireAdmin } from "@/lib/users";

/** GET /api/v1/admin/projects — tous les projets, tous propriétaires (lecture seule). */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ projects: await listAllProjectsAdmin(user) });
});
