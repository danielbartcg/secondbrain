import { json, withUser } from "@/lib/api";
import { deleteComment } from "@/lib/tasks";

type P = { id: string };

/** DELETE /api/v1/comments/:id — auteur du commentaire ou propriétaire du projet ; renvoie la fiche tâche. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ task: await deleteComment(user.id, params.id) }));
