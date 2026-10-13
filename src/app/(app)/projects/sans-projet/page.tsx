import { requireUser } from "@/lib/auth";
import { listOrphanTasks } from "@/lib/projects";
import { OrphanTasks } from "@/components/projects/OrphanTasks";

export const metadata = { title: "Sans projet" };

/** Projet virtuel « Sans projet » : mes tâches qui ne sont rattachées à aucun projet. */
export default async function OrphanTasksPage() {
  const user = await requireUser();
  const tasks = await listOrphanTasks(user.id);
  return <OrphanTasks initial={tasks} />;
}
