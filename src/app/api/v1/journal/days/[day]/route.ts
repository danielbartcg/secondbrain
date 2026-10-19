import { json, withUser } from "@/lib/api";
import { getJournalDay } from "@/lib/journal";
import { journalDaySchema } from "@/lib/schemas-journal";

type P = { day: string };

/** GET /api/v1/journal/days/:day — `{ journal: { day, entries, activity, blocks } }` (saisies du jour, activité calculée, blocs activés). */
export const GET = withUser<P>(async (_req, { params, user }) => {
  return json({ journal: await getJournalDay(user, journalDaySchema.parse(params.day)) });
});
