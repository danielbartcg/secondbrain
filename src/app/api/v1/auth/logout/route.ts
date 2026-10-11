import { json, withUser } from "@/lib/api";
import { destroySession } from "@/lib/auth";

/** POST /api/v1/auth/logout — révoque la session courante (cookie ou Bearer). */
export const POST = withUser(async () => {
  await destroySession();
  return json({ ok: true });
});
