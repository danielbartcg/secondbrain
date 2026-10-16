import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { getActivity } from "@/lib/activity";
import { listProjects } from "@/lib/projects";
import { listMindMaps } from "@/lib/mindmaps";
import { ActivityView } from "@/components/activity/ActivityView";

export const metadata = { title: "Activité" };

/** Rapport d'activité (7 derniers jours par défaut ; période et filtres côté client). */
export default async function Page() {
  const user = await requireUser();
  const [activity, projects, maps] = await Promise.all([getActivity(user, { period: "7d" }), listProjects(user.id), listMindMaps(user.id)]);
  return (
    <ActivityView
      initial={activity}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      maps={maps.map((m) => ({ id: m.id, title: m.title }))}
      isAdmin={isAdmin(user)}
    />
  );
}
