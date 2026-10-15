import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteRisk, updateRisk } from "@/lib/risks";
import { updateRiskSchema } from "@/lib/schemas-risks";

type P = { riskId: string };

/** PATCH /api/v1/risks/:riskId — modifie un risque ; renvoie `{ risks }` (liste du projet). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateRiskSchema);
  return json({ risks: await updateRisk(user.id, params.riskId, input) });
});

/** DELETE /api/v1/risks/:riskId — supprime un risque ; renvoie `{ risks }`. */
export const DELETE = withUser<P>(async (_req: NextRequest, { params, user }) => {
  return json({ risks: await deleteRisk(user.id, params.riskId) });
});
