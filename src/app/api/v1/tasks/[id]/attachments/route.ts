import { json, withUser } from "@/lib/api";
import { listTaskAttachments } from "@/lib/attachments";

type P = { id: string };

/** GET /api/v1/tasks/:id/attachments — `{ attachments }` : pièces jointes de tous les commentaires de la tâche. */
export const GET = withUser<P>(async (_req, { params, user }) => json({ attachments: await listTaskAttachments(user.id, params.id) }));
