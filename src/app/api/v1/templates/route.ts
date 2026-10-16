import { json, withUser } from "@/lib/api";
import { listTemplates } from "@/lib/templates";

/** GET /api/v1/templates — projets types et cartes types disponibles (choix à la création). */
export const GET = withUser(async () => json({ templates: await listTemplates() }));
