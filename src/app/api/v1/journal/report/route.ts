import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getJournalReport } from "@/lib/journal";
import { journalBlockSchema, journalDaySchema } from "@/lib/schemas-journal";

/** GET /api/v1/journal/report?block=&from=&to= — `{ report }` : évolution d'un bloc entre deux jours (366 j max). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const q = req.nextUrl.searchParams;
  const report = await getJournalReport(user.id, journalBlockSchema.parse(q.get("block")), journalDaySchema.parse(q.get("from")), journalDaySchema.parse(q.get("to")));
  return json({ report });
});
