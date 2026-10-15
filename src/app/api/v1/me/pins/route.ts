import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { listPins, setPin } from "@/lib/pins";
import { setPinSchema } from "@/lib/schemas";

/** GET /api/v1/me/pins — projets et cartes épinglés dans le menu. */
export const GET = withUser(async (_req, { user }) => json({ pins: await listPins(user.id) }));

/** PUT /api/v1/me/pins — `{ kind: "PROJECT"|"MINDMAP", id, pinned }` → `{ pins }`. */
export const PUT = withUser(async (req: NextRequest, { user }) => {
  const { kind, id, pinned } = await parseBody(req, setPinSchema);
  return json({ pins: await setPin(user.id, kind, id, pinned) });
});
