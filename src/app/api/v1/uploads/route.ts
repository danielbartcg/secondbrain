import type { NextRequest } from "next/server";
import { badRequest, json, withUser } from "@/lib/api";
import { saveImage } from "@/lib/uploads";

/**
 * POST /api/v1/uploads — multipart/form-data, champ `file` (image).
 * Réponse : { url } — URL à insérer dans les notes (servie par /media/…).
 */
export const POST = withUser(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Champ `file` manquant.");
  return json(await saveImage(file), { status: 201 });
});
