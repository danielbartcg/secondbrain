import { json, withPublic } from "@/lib/api";
import { registrationOpen } from "@/lib/settings";
import { mailConfigured } from "@/lib/account-email";

/** GET /api/v1/auth/options — `{ registration, passwordReset }` : ce que proposent les écrans de connexion. */
export const GET = withPublic(async () => json({ registration: await registrationOpen(), passwordReset: await mailConfigured() }));
