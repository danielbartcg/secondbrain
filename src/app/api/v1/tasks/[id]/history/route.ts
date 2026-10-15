import { json, withUser } from "@/lib/api";
import { getTaskHistory } from "@/lib/tasks";

type P = { id: string };

/** GET /api/v1/tasks/:id/history — piste d'audit de la tâche (plus récent d'abord, 300 max). */
export const GET = withUser<P>(async (_req, { params, user }) => json({ events: await getTaskHistory(user.id, params.id) }));
