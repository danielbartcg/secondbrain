import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { linkNodeTask, listNodeTasks } from "@/lib/tasks";
import { linkNodeTaskSchema } from "@/lib/schemas";

type P = { id: string; nodeId: string };

/** GET /api/v1/mindmaps/:id/nodes/:nodeId/tasks — tâches rattachées au nœud (+ compteurs). */
export const GET = withUser<P>(async (_req, { params, user }) => json(await listNodeTasks(user.id, params.nodeId)));

/** POST /api/v1/mindmaps/:id/nodes/:nodeId/tasks — `{ taskId }` rattache une tâche existante. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, linkNodeTaskSchema);
  return json(await linkNodeTask(user.id, params.nodeId, input.taskId), { status: 201 });
});
