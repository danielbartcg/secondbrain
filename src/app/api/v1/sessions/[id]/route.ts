import { json, withUser } from "@/lib/api";
import { deleteWorkSession } from "@/lib/tasks";

type P = { id: string };

/** DELETE /api/v1/sessions/:id — retire une de ses sessions de travail ; renvoie les sessions restantes de la tâche. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ sessions: await deleteWorkSession(user.id, params.id) }));
