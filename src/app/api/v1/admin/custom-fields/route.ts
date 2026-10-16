import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { createCustomField, customFieldUsage, listCustomFields } from "@/lib/custom-fields";
import { customFieldSchema } from "@/lib/schemas";

/** GET /api/v1/admin/custom-fields — toutes les définitions (archivées comprises) et le nombre de projets renseignés. */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  const [fields, usage] = await Promise.all([listCustomFields({ includeArchived: true }), customFieldUsage()]);
  return json({ fields, usage });
});

/** POST /api/v1/admin/custom-fields — `{ label, type: "TEXT"|"LIST", options?: { label }[] }`. */
export const POST = withUser(async (req: NextRequest, { user }) => {
  requireAdmin(user);
  const input = await parseBody(req, customFieldSchema);
  return json({ fields: await createCustomField(user, input) }, { status: 201 });
});
