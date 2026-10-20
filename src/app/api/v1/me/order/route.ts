import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseBody, withUser } from "@/lib/api";
import { MAX_ORDERED, getItemOrder, setItemOrder } from "@/lib/item-order";

const kindSchema = z.enum(["PROJECT", "MINDMAP"]);
const orderSchema = z.object({ kind: kindSchema, ids: z.array(z.string().min(1).max(64)).max(MAX_ORDERED) });

/** GET /api/v1/me/order?kind=PROJECT|MINDMAP — `{ kind, ids }` : mon ordre (rang croissant). */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const kind = kindSchema.parse(req.nextUrl.searchParams.get("kind"));
  return json({ kind, ids: await getItemOrder(user.id, kind) });
});

/** PUT /api/v1/me/order — `{ kind, ids }` (ordre complet) → `{ kind, ids }` (éléments inaccessibles ignorés). */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const { kind, ids } = await parseBody(req, orderSchema);
  return json({ kind, ids: await setItemOrder(user.id, kind, ids) });
});
