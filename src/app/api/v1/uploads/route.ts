import type { NextRequest } from "next/server";
import { ApiError, badRequest, json, withUser } from "@/lib/api";
import { RATE_LIMITED_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { saveImage } from "@/lib/uploads";

/**
 * POST /api/v1/uploads — multipart/form-data, champ `file` (image).
 * Réponse : { url } — URL à insérer dans les notes (servie par /media/…).
 */
export const POST = withUser(async (req: NextRequest, { user }) => {
  if (!rateLimit(`upload:${user.id}`, 120, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", RATE_LIMITED_MESSAGE);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Champ `file` manquant.");
  return json(await saveImage(file), { status: 201 });
});
