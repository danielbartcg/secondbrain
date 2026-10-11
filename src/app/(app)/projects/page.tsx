import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { ProjectList } from "@/components/projects/ProjectList";

export const metadata = { title: "Projets" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await listProjects(user.id);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <ProjectList initial={projects} />
    </div>
  );
}
