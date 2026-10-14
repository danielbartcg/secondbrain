import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { getProfile, updateProfile } from "@/lib/users";
import { updateProfileSchema } from "@/lib/schemas";

/** GET /api/v1/me — mon profil (prénom, nom, photo, thème, rôle, manager, nombre de N-1). */
export const GET = withUser(async (_req, { user }) => json({ profile: await getProfile(user) }));

/** PATCH /api/v1/me — `{ firstName?, lastName?, avatarUrl?, theme? }` (préférences). */
export const PATCH = withUser(async (req: NextRequest, { user }) => {
  const input = await parseBody(req, updateProfileSchema);
  return json({ profile: await updateProfile(user, input) });
});
