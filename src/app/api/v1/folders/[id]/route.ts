import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteFolder, updateFolder } from "@/lib/projects";
import { updateFolderSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/folders/:id — renomme ou déplace (`parentId`, null = racine) ; renvoie le projet. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateFolderSchema);
  return json({ project: await updateFolder(user.id, params.id, input) });
});

/** DELETE /api/v1/folders/:id — documents et sous-dossiers remontent dans le parent. */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ project: await deleteFolder(user.id, params.id) }));
