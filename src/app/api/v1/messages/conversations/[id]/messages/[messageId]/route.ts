import { json, withUser } from "@/lib/api";
import { deleteMessage } from "@/lib/messages";

type P = { id: string; messageId: string };

/** DELETE /api/v1/messages/conversations/:id/messages/:messageId — supprimer mon message (contenu effacé). */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ message: await deleteMessage(user.id, params.id, params.messageId) }));
