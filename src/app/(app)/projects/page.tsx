import { requireUser } from "@/lib/auth";
import { listOrphanTasks, listProjects } from "@/lib/projects";
import { ProjectList } from "@/components/projects/ProjectList";

export const metadata = { title: "Projets" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const [projects, orphans] = await Promise.all([listProjects(user.id), listOrphanTasks(user.id)]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <ProjectList initial={projects} orphanCount={orphans.filter((t) => t.status !== "CLOSED").length} />
    </div>
  );
}
