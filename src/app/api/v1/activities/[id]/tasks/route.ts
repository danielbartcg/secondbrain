import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createTask } from "@/lib/projects";
import { createTaskSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/activities/:id/tasks — tâche rattachée à une activité. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createTaskSchema);
  return json(await createTask(user.id, { activityId: params.id }, input), { status: 201 });
});
