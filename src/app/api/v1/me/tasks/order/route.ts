import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { listMyTaskOrder, orderMyTasks } from "@/lib/tasks";
import { orderMyTasksSchema } from "@/lib/schemas";

/** GET /api/v1/me/tasks/order — `{ taskIds }` : mon ordre relatif (application desktop). */
export const GET = withUser(async (_req: NextRequest, { user }) => json({ taskIds: await listMyTaskOrder(user.id) }));

/** PUT /api/v1/me/tasks/order — `{ taskIds }` dans l'ordre voulu (ordre relatif personnel). */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, orderMyTasksSchema);
  await orderMyTasks(user.id, input.taskIds);
  return json({ ok: true });
});
