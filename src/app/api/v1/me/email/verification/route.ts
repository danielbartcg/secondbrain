import { ApiError, json, withUser } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/account-email";

/** POST /api/v1/me/email/verification — renvoie le lien de validation de l'adresse. */
export const POST = withUser(async (_req, { user }) => {
  if (!rateLimit(`verify-mail:${user.id}`, 5, 60 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de demandes, réessayez dans une heure.");
  try {
    await sendVerificationEmail(user);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "SMTP_ERROR", "L'e-mail n'a pas pu être envoyé, réessayez plus tard.");
  }
  return json({ ok: true, to: user.email });
});
