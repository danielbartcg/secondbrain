import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createRisk, listRisks } from "@/lib/risks";
import { createRiskSchema } from "@/lib/schemas-risks";

type P = { id: string };

/** GET /api/v1/projects/:id/risks — registre des risques et opportunités (`{ risks }`). */
export const GET = withUser<P>(async (_req: NextRequest, { params, user }) => {
  return json({ risks: await listRisks(user.id, params.id) });
});

/** POST /api/v1/projects/:id/risks — déclare un risque ou une opportunité ; renvoie `{ risks }`. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createRiskSchema);
  return json({ risks: await createRisk(user.id, params.id, input) }, { status: 201 });
});
