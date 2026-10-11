import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMindMap } from "@/lib/mindmaps";
import { ApiError } from "@/lib/api";
import { MindMapEditor } from "@/components/mindmap/MindMapEditor";

export default async function MindMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let map;
  try {
    map = await getMindMap(user.id, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <MindMapEditor initial={map} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const map = await getMindMap(user.id, id);
    return { title: map.title };
  } catch {
    return { title: "Carte mentale" };
  }
}
