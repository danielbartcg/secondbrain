import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { saveJournalBlock } from "@/lib/journal";
import { journalDaySchema, journalSaveSchema, journalWrittenBlockSchema } from "@/lib/schemas-journal";

type P = { day: string; block: string };

/**
 * PUT /api/v1/journal/days/:day/blocks/:block — `{ content? (HTML) | text?, mode?: "replace"|"append" }`
 * → `{ entry | null }` (contenu vide : saisie supprimée).
 */
export const PUT = withUser<P>(async (req: NextRequest, { params, user }) => {
  const day = journalDaySchema.parse(params.day);
  const block = journalWrittenBlockSchema.parse(params.block);
  const input = await parseBody(req, journalSaveSchema);
  return json({ entry: await saveJournalBlock(user.id, day, block, input) });
});
