import { json, withUser } from "@/lib/api";
import { listTeamTasks } from "@/lib/tasks";

/** GET /api/v1/me/team — mes N-1 directs et leurs tâches (lecture seule). */
export const GET = withUser(async (_req, { user }) => json(await listTeamTasks(user.id)));
