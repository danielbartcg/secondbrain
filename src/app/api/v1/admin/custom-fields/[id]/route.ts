import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { deleteCustomField, updateCustomField } from "@/lib/custom-fields";
import { customFieldUpdateSchema } from "@/lib/schemas";

type P = { id: string };

/** PATCH /api/v1/admin/custom-fields/:id — `{ label?, active?, options?: { id?, label }[], order? }` (options : liste complète). */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  requireAdmin(user);
  const input = await parseBody(req, customFieldUpdateSchema);
  return json({ fields: await updateCustomField(user, params.id, input) });
});

/** DELETE /api/v1/admin/custom-fields/:id — supprime le champ et ses valeurs dans tous les projets. */
export const DELETE = withUser<P>(async (_req, { params, user }) => {
  requireAdmin(user);
  return json({ fields: await deleteCustomField(user, params.id) });
});
