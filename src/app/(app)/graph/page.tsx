import { requireUser } from "@/lib/auth";
import { getKnowledgeGraph } from "@/lib/links";
import { listProjects } from "@/lib/projects";
import { listMindMaps } from "@/lib/mindmaps";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";

export const metadata = { title: "Graphe des liens" };

/** Graphe de connaissances : objets reliés par des liens [[…]] dans les notes. */
export default async function Page() {
  const user = await requireUser();
  const [graph, projects, maps] = await Promise.all([getKnowledgeGraph(user.id), listProjects(user.id), listMindMaps(user.id)]);
  return <KnowledgeGraph graph={graph} projects={projects.map((p) => ({ id: p.id, name: p.name }))} maps={maps.map((m) => ({ id: m.id, title: m.title }))} />;
}
