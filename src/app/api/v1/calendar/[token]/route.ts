import { NextResponse, type NextRequest } from "next/server";
import { ApiError, notFound, withPublic } from "@/lib/api";
import { feedOwner, renderCalendar } from "@/lib/calendar-feed";
import { rateLimit } from "@/lib/rate-limit";

type P = { token: string };

/**
 * GET /api/v1/calendar/:token.ics — flux iCal personnel (public, jeton secret
 * dans l'URL : les agendas ne savent pas s'authentifier). 404 si le jeton est
 * inconnu ou révoqué ; 60 lectures / 15 min par jeton.
 */
export const GET = withPublic<P>(async (req: NextRequest, { params }) => {
  const token = params.token.replace(/\.ics$/i, "");
  if (!rateLimit(`calendar:${token.slice(0, 24)}`, 60, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de requêtes.");
  const owner = await feedOwner(token);
  if (!owner) throw notFound("Calendrier");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const body = await renderCalendar(owner.userId, owner.name, `${proto}://${host}`);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="second-brain.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
});
