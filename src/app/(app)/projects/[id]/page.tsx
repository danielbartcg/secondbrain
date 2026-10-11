import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { ApiError } from "@/lib/api";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";

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
  return <ProjectWorkspace initial={project} currentUserId={user.id} />;
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
