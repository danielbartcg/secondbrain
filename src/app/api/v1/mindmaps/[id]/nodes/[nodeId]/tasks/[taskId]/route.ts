import { json, withUser } from "@/lib/api";
import { unlinkNodeTask } from "@/lib/tasks";

type P = { id: string; nodeId: string; taskId: string };

/** DELETE /api/v1/mindmaps/:id/nodes/:nodeId/tasks/:taskId — détache la tâche du nœud (la tâche subsiste). */
export const DELETE = withUser<P>(async (_req, { params, user }) => json(await unlinkNodeTask(user.id, params.nodeId, params.taskId)));
