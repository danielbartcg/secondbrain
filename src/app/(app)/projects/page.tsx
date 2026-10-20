import { requireUser } from "@/lib/auth";
import { listOrphanTasks, listProjects } from "@/lib/projects";
import { ProjectList } from "@/components/projects/ProjectList";
import { listProjectTypes } from "@/lib/project-types";
import { getItemOrder } from "@/lib/item-order";

export const metadata = { title: "Projets" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const [projects, orphans, projectTypes, order] = await Promise.all([listProjects(user.id), listOrphanTasks(user.id), listProjectTypes(user.id), getItemOrder(user.id, "PROJECT")]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <ProjectList initial={projects} orphanCount={orphans.filter((t) => t.status !== "CLOSED").length} currentUserId={user.id} projectTypes={projectTypes} order={order} />
    </div>
  );
}
