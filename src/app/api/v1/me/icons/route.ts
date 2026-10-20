import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseBody, withUser } from "@/lib/api";
import { addUserIcon, listUserIcons } from "@/lib/user-icons";

/** GET /api/v1/me/icons — `{ icons: { id, url, createdAt }[] }` (mes icônes personnalisées). */
export const GET = withUser(async (_req, { user }) => json({ icons: await listUserIcons(user.id) }));

/** POST /api/v1/me/icons — `{ url }` (image téléversée via /uploads) → `201 { icons }`. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  const { url } = await parseBody(req, z.object({ url: z.string().max(300) }));
  return json({ icons: await addUserIcon(user.id, url) }, { status: 201 });
});
