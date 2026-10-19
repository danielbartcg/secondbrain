import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getRiskOverview } from "@/lib/risks";

/**
 * GET /api/v1/me/risks?scope=mine|projects — matrice des risques du tableau
 * de bord : risques non clos dont je suis responsable (`mine`, défaut) ou de
 * tous les projets dont je suis propriétaire (`projects`).
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const scope = req.nextUrl.searchParams.get("scope") === "projects" ? "projects" : "mine";
  return json({ overview: await getRiskOverview(user.id, scope) });
});
