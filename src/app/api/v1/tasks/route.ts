import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createTask, listOrphanTasks } from "@/lib/projects";
import { createFreeTaskSchema } from "@/lib/schemas";

/** GET /api/v1/tasks — mes tâches sans projet (projet virtuel « Sans projet »). */
export const GET = withUser(async (_req, { user }) => json({ tasks: await listOrphanTasks(user.id) }));

/**
 * POST /api/v1/tasks — crée une tâche avec un rattachement facultatif
 * (`activityId` ⇒ étape et projet déduits ; `stageId` ⇒ projet déduit ;
 * `projectId` seul ⇒ sans étape ; rien ⇒ tâche sans projet) et éventuellement
 * rattachée à un nœud de carte (`nodeId`). Renvoie `{ project | null, task }`.
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const { projectId, stageId, activityId, nodeId, ...input } = await parseBody(req, createFreeTaskSchema);
  return json(await createTask(user.id, { projectId, stageId, activityId, nodeId }, input), { status: 201 });
});
