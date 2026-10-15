import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { getNotificationSettings, updateNotificationSettings } from "@/lib/settings";
import { notificationSettingsSchema } from "@/lib/schemas";

/** GET /api/v1/admin/notifications — paramètres SMTP (sans mot de passe), activation des types. */
export const GET = withUser(async (_req, { user }) => {
  requireAdmin(user);
  return json({ settings: await getNotificationSettings() });
});

/** PATCH /api/v1/admin/notifications — mise à jour partielle ; `smtpPassword` absent = inchangé. */
export const PATCH = withUser(async (req: NextRequest, { user }) => {
  requireAdmin(user);
  const input = await parseBody(req, notificationSettingsSchema);
  return json({ settings: await updateNotificationSettings(input) });
});
