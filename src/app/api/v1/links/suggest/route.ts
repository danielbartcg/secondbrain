import type { NextRequest } from "next/server";
import { ApiError, json, withUser } from "@/lib/api";
import { suggestLinks } from "@/lib/links";
import { rateLimit } from "@/lib/rate-limit";

/** GET /api/v1/links/suggest?q= — objets liables (`[[…]]`) dont le titre contient `q` (`{ items }`, 4 par type). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`links:${user.id}`, 300, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de requêtes.");
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  return json({ items: await suggestLinks(user.id, q) });
});
