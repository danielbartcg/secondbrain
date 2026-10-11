import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createFolder } from "@/lib/projects";
import { createFolderSchema } from "@/lib/schemas";

type P = { id: string };

/** POST /api/v1/projects/:id/folders — crée un dossier (`parentId` null = racine) ; renvoie le projet. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createFolderSchema);
  return json({ project: await createFolder(user.id, params.id, input) }, { status: 201 });
});
