import { redirect } from "next/navigation";

/** Ancienne adresse de la fiche tâche : redirige vers `/tasks/:taskId`. */
export default async function LegacyTaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { taskId } = await params;
  redirect(`/tasks/${taskId}`);
}
