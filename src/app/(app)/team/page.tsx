import { requireUser } from "@/lib/auth";
import { listTeamTasks } from "@/lib/tasks";
import { TeamOverview } from "@/components/admin/TeamOverview";

export const metadata = { title: "Mon équipe" };

/** Manager : tâches de mes N-1 directs (lecture seule). */
export default async function Page() {
  const user = await requireUser();
  const data = await listTeamTasks(user.id);
  return <TeamOverview members={data.members} tasks={data.tasks} />;
}
