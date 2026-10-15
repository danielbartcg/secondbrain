import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { setRiskTasks } from "@/lib/risks";
import { setRiskTasksSchema } from "@/lib/schemas-risks";

type P = { riskId: string };

/** PUT /api/v1/risks/:riskId/tasks — remplace les tâches liées `{ taskIds }` ; renvoie `{ risks }`. */
export const PUT = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { taskIds } = await parseBody(req, setRiskTasksSchema);
  return json({ risks: await setRiskTasks(user.id, params.riskId, taskIds) });
});
