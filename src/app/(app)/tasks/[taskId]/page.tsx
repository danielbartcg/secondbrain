import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getTaskDetail } from "@/lib/tasks";
import { ApiError } from "@/lib/api";
import { TaskSheet } from "@/components/projects/TaskSheet";

type Params = Promise<{ taskId: string }>;

/** Fiche tâche (avec ou sans projet). */
export default async function TaskPage({ params }: { params: Params }) {
  const { taskId } = await params;
  const user = await requireUser();
  let task;
  try {
    task = await getTaskDetail(user.id, taskId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <TaskSheet initial={task} currentUserId={user.id} />;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { taskId } = await params;
  try {
    const user = await requireUser();
    const task = await getTaskDetail(user.id, taskId);
    return { title: task.name };
  } catch {
    return { title: "Tâche" };
  }
}
