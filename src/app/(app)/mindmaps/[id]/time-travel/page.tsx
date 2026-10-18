import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { getMindMap } from "@/lib/mindmaps";
import { MapTimeTravel } from "@/components/mindmap/MapTimeTravel";

export const metadata = { title: "Voyage dans le temps" };

/** Voyage dans le temps d'une carte : arborescence à une date passée (données chargées côté client). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let map;
  try {
    map = await getMindMap(user.id, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <MapTimeTravel mapId={map.id} title={map.title} />;
}
