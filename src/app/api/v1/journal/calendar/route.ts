import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { journalDaysWithEntries } from "@/lib/journal";
import { journalDaySchema } from "@/lib/schemas-journal";

/** GET /api/v1/journal/calendar?from=&to= — `{ days: string[] }` : jours renseignés (pastilles du calendrier). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const q = req.nextUrl.searchParams;
  return json({ days: await journalDaysWithEntries(user.id, journalDaySchema.parse(q.get("from")), journalDaySchema.parse(q.get("to"))) });
});
