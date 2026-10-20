import { json, withUser } from "@/lib/api";
import { deleteAttachment } from "@/lib/attachments";

type P = { id: string };

/** DELETE /api/v1/attachments/:id — retire la pièce jointe → `{ attachments }` (liste à jour de la tâche ou du nœud). */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ attachments: await deleteAttachment(user.id, params.id) }));
