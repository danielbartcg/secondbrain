import { listAllProjectsAdmin } from "@/lib/projects";
import { AdminProjects } from "@/components/admin/AdminProjects";

export const metadata = { title: "Administration · Projets" };

/** Tous les projets, tous propriétaires (lecture seule). */
export default async function Page() {
  return <AdminProjects projects={await listAllProjectsAdmin()} />;
}
