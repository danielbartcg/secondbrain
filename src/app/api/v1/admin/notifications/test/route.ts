import { ApiError, json, withUser } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { sendTestMail } from "@/lib/mailer";

/** POST /api/v1/admin/notifications/test — e-mail de test à l'adresse de l'administrateur. */
export const POST = withUser(async (_req, { user }) => {
  requireAdmin(user);
  if (!rateLimit(`smtp-test:${user.id}`, 10, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop d'essais, réessayez dans quelques minutes.");
  try {
    await sendTestMail(user.email);
  } catch (e) {
    throw new ApiError(502, "SMTP_ERROR", `Échec de l'envoi : ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
  return json({ ok: true, to: user.email });
});
