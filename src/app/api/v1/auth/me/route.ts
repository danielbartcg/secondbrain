import { json, withUser } from "@/lib/api";
import { toPublicUser } from "@/lib/auth";

/** GET /api/v1/auth/me — profil de l'utilisateur connecté. */
export const GET = withUser(async (_req, { user }) => json({ user: toPublicUser(user) }));
