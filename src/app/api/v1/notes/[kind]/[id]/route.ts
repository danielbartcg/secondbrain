import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { getDocument, saveNotes } from "@/lib/notes";
import { updateNotesSchema } from "@/lib/schemas";

type P = { kind: string; id: string };

/** GET /api/v1/notes/:kind/:id — document de notes d'un objet (titre, fil d'Ariane, lien, HTML assaini). */
export const GET = withUser<P>(async (_req, { params, user }) => json({ document: await getDocument(user.id, `${params.kind}:${params.id}`) }));

/** PATCH /api/v1/notes/:kind/:id — `{ notes }` (HTML) ; les cartes écrivent sur leur nœud racine. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateNotesSchema);
  return json({ document: await saveNotes(user.id, `${params.kind}:${params.id}`, input.notes) });
});
