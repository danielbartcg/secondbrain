import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteDocument, updateDocument } from "@/lib/documents";
import { updateDocumentSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/documents/:id — renomme ou rattache à un livrable (`deliverableId: null` détache). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateDocumentSchema);
  return json({ project: await updateDocument(user.id, params.id, input) });
});

/** DELETE /api/v1/documents/:id — auteur du dépôt ou propriétaire du projet. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ project: await deleteDocument(user.id, params.id) }));
