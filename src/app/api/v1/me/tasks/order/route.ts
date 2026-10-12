import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { orderMyTasks } from "@/lib/tasks";
import { orderMyTasksSchema } from "@/lib/schemas";

/** PUT /api/v1/me/tasks/order — `{ taskIds }` dans l'ordre voulu (ordre relatif personnel). */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, orderMyTasksSchema);
  await orderMyTasks(user.id, input.taskIds);
  return json({ ok: true });
});
