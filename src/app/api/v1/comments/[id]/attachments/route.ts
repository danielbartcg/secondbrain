import type { NextRequest } from "next/server";
import { badRequest, json, withUser } from "@/lib/api";
import { addCommentAttachment } from "@/lib/attachments";

type P = { id: string };

/** POST /api/v1/comments/:id/attachments — multipart `file` (auteur du commentaire) → `201 { attachments }` (toute la tâche). */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Champ `file` manquant.");
  return json({ attachments: await addCommentAttachment(user.id, params.id, file) }, { status: 201 });
});
