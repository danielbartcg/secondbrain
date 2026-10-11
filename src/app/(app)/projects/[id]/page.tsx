import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { ApiError } from "@/lib/api";
import { ProjectBoard } from "@/components/projects/ProjectBoard";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let project;
  try {
    project = await getProject(user.id, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <ProjectBoard initial={project} />
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const project = await getProject(user.id, id);
    return { title: project.name };
  } catch {
    return { title: "Projet" };
  }
}
