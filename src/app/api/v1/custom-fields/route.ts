import { json, withUser } from "@/lib/api";
import { listCustomFields } from "@/lib/custom-fields";

/** GET /api/v1/custom-fields — définitions actives des champs personnalisés des projets. */
export const GET = withUser(async () => json({ fields: await listCustomFields() }));
