import { requireUser } from "@/lib/auth";
import { listMindMaps } from "@/lib/mindmaps";
import { getDashboard } from "@/lib/dashboard";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const user = await requireUser();
  const [dashboard, maps] = await Promise.all([getDashboard(user.id), listMindMaps(user.id)]);
  return <HomeDashboard data={dashboard} maps={maps} userName={user.name} />;
}
