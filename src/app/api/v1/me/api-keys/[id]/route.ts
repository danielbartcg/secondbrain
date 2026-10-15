import { json, withUser } from "@/lib/api";
import { revokeApiKey } from "@/lib/api-keys";

type P = { id: string };

/** DELETE /api/v1/me/api-keys/:id — révoque la clé (effet immédiat). */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  await revokeApiKey(user.id, params.id);
  return json({ ok: true });
});
