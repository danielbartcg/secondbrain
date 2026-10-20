import { json, withUser } from "@/lib/api";
import { removeUserIcon } from "@/lib/user-icons";

type P = { id: string };

/** DELETE /api/v1/me/icons/:id — retire l'icône de ma bibliothèque → `{ icons }`. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ icons: await removeUserIcon(user.id, params.id) }));
