import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { listJournalEntries } from "@/lib/journal";
import { journalDaySchema, journalWrittenBlockSchema } from "@/lib/schemas-journal";

/** GET /api/v1/journal/entries?from=&to=&blocks=POSITIVE,NEGATIVE — `{ entries }` (plus récentes d'abord, 366 j max). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const q = req.nextUrl.searchParams;
  const blocks = (q.get("blocks") ?? "").split(",").filter(Boolean).map((b) => journalWrittenBlockSchema.parse(b));
  return json({ entries: await listJournalEntries(user.id, journalDaySchema.parse(q.get("from")), journalDaySchema.parse(q.get("to")), blocks) });
});
