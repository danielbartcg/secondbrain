import type { NextRequest } from "next/server";
import { badRequest, json, withUser } from "@/lib/api";
import { addNodeAttachment, listNodeAttachments } from "@/lib/attachments";

type P = { id: string; nodeId: string };

/** GET /api/v1/mindmaps/:id/nodes/:nodeId/attachments — `{ attachments }` (carte lisible). */
export const GET = withUser<P>(async (_req, { params, user }) => json({ attachments: await listNodeAttachments(user.id, params.id, params.nodeId) }));

/** POST /api/v1/mindmaps/:id/nodes/:nodeId/attachments — multipart `file` (carte modifiable) → `201 { attachments }`. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Champ `file` manquant.");
  return json({ attachments: await addNodeAttachment(user.id, params.id, params.nodeId, file) }, { status: 201 });
});
