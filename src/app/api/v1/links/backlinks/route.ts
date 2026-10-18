import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getBacklinks } from "@/lib/links";

/** GET /api/v1/links/backlinks?ref=kind:id — « Mentionné dans » : objets accessibles dont les notes lient `ref` (`{ items }`). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const ref = (req.nextUrl.searchParams.get("ref") ?? "").slice(0, 100);
  return json({ items: await getBacklinks(user.id, ref) });
});
