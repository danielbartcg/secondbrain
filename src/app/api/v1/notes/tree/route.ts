import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { children } from "@/lib/notes";

/**
 * GET /api/v1/notes/tree?parent=root|section:mindmaps|mindmap:<id>|node:<id>|section:projects|project:<id>|stage:<id>|activity:<id>|section:orphans
 * Enfants directs d'un élément de l'arborescence « Prise de notes » (chargement paresseux).
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const parent = req.nextUrl.searchParams.get("parent") ?? "root";
  return json({ parent, children: await children(user.id, parent) });
});
