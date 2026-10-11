import type { NextRequest } from "next/server";
import { json, withUser } from "@/lib/api";
import { getDashboard } from "@/lib/dashboard";

/**
 * GET /api/v1/dashboard?horizon=30 — tableau de bord personnel : mes tâches,
 * échéances (tâches et livrables) sous `horizon` jours, répartitions par
 * statut, avancement global, projets.
 */
export const GET = withUser(async (req: NextRequest, { user }) => {
  const raw = Number(req.nextUrl.searchParams.get("horizon") ?? "30");
  const horizonDays = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
  return json({ dashboard: await getDashboard(user.id, { horizonDays }) });
});
