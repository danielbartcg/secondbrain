import type { NextRequest } from "next/server";
import { badRequest, json, withUser } from "@/lib/api";
import { listDocuments, uploadDocument } from "@/lib/documents";

type P = { id: string };

/** GET /api/v1/projects/:id/documents — documents du projet. */
export const GET = withUser<P>(async (_req, { params, user }) => json({ documents: await listDocuments(user.id, params.id) }));

/**
 * POST /api/v1/projects/:id/documents — multipart/form-data :
 * `file` (obligatoire), `name?`, `deliverableId?`. Renvoie le projet à jour.
 */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Champ `file` manquant.");
  const name = form?.get("name");
  const deliverableId = form?.get("deliverableId");
  return json(
    {
      project: await uploadDocument(user.id, params.id, file, {
        name: typeof name === "string" ? name : undefined,
        deliverableId: typeof deliverableId === "string" && deliverableId ? deliverableId : null,
      }),
    },
    { status: 201 },
  );
});
