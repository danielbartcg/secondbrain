import { requireAdminPage } from "@/lib/admin-page";
import { listAllTasksAdmin } from "@/lib/tasks";
import { TaskOverviewTable } from "@/components/admin/TaskOverviewTable";

export const metadata = { title: "Administration · Tâches" };

/** Toutes les tâches de tout le monde (lecture seule ; les fiches s'ouvrent en consultation). */
export default async function Page() {
  const admin = await requireAdminPage();
  return <TaskOverviewTable tasks={await listAllTasksAdmin(admin)} />;
}
