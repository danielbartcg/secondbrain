import { requireAdminPage } from "@/lib/admin-page";
import { listTemplates } from "@/lib/templates";
import { listProjects } from "@/lib/projects";
import { listMindMaps } from "@/lib/mindmaps";
import { AdminTemplates } from "@/components/admin/AdminTemplates";

export const metadata = { title: "Administration · Modèles" };

export default async function Page() {
  const user = await requireAdminPage();
  const [templates, projects, maps] = await Promise.all([listTemplates(), listProjects(user.id), listMindMaps(user.id)]);
  return <AdminTemplates initial={templates} projects={projects.map((p) => ({ id: p.id, name: p.name }))} maps={maps.map((m) => ({ id: m.id, title: m.title }))} />;
}
