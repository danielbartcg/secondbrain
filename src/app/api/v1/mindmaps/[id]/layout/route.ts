import { json, withUser } from "@/lib/api";
import { resetLayout } from "@/lib/mindmaps";

type P = { id: string };

/** DELETE /api/v1/mindmaps/:id/layout — « Affichage optimisé » : efface les positions manuelles ; renvoie la carte. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ mindmap: await resetLayout(user.id, params.id) }));
