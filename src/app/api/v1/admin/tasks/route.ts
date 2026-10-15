import { json, withUser } from "@/lib/api";
import { listAllTasksAdmin } from "@/lib/tasks";
import { requireAdmin } from "@/lib/users";

/** GET /api/v1/admin/tasks — toutes les tâches de tout le monde (lecture seule, 5 000 max). */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ tasks: await listAllTasksAdmin(user) });
});
