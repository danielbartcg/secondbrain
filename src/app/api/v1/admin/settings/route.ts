import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseBody, withUser } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { getRegistrationSettings, setRegistrationEnabled } from "@/lib/settings";

const schema = z.object({ registrationEnabled: z.boolean() });

/** GET /api/v1/admin/settings — `{ registration: { enabled, forcedClosed, open } }`. */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ registration: await getRegistrationSettings() });
});

/** PATCH /api/v1/admin/settings — `{ registrationEnabled }` : ouvre / ferme les inscriptions libres. */
export const PATCH = withUser(async (req: NextRequest, { user }) => {
  requireAdmin(user);
  const { registrationEnabled } = await parseBody(req, schema);
  return json({ registration: await setRegistrationEnabled(registrationEnabled) });
});
