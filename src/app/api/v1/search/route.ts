import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { search, type SearchKind } from "@/lib/search";

/**
 * GET /api/v1/search?q=…&kinds=project,task,node,mindmap&limit=6
 * Recherche globale (auto-complétion) : projets, tâches, nœuds et cartes
 * accessibles, sur le titre / nom et la description / les notes.
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const kinds = req.nextUrl.searchParams.get("kinds")?.split(",").filter(Boolean) as SearchKind[] | undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "6");
  return json({ results: await search(user.id, q, { kinds, limitPerKind: Number.isFinite(limit) ? limit : 6 }) });
});
