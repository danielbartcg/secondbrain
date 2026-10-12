import { requireUser } from "@/lib/auth";
import { getMyTasks } from "@/lib/tasks";
import { TaskOrganizer } from "@/components/organizer/TaskOrganizer";

export const metadata = { title: "Organiser mes tâches" };

export default async function OrganizePage() {
  const user = await requireUser();
  const data = await getMyTasks(user.id);
  return <TaskOrganizer initial={data} />;
}
