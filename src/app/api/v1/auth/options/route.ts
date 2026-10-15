import { json, withPublic } from "@/lib/api";
import { registrationAllowed } from "@/lib/auth";
import { mailConfigured } from "@/lib/account-email";

/** GET /api/v1/auth/options — `{ registration, passwordReset }` : ce que proposent les écrans de connexion. */
export const GET = withPublic(async () => json({ registration: registrationAllowed(), passwordReset: await mailConfigured() }));
