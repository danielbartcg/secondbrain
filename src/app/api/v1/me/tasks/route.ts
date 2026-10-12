import { json, withUser } from "@/lib/api";
import { getMyTasks } from "@/lib/tasks";

/**
 * GET /api/v1/me/tasks — « mes tâches » (affectées à moi, ou non affectées dans
 * mes projets) des projets actifs, avec projet, étape, priorité, complexité,
 * rang personnel et sessions de travail planifiées. Base des vues
 * Calendrier / Sélection / Synthèse.
 */
export const GET = withUser(async (_req, { user }) => json(await getMyTasks(user.id)));
