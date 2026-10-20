import { requireUser } from "@/lib/auth";
import { listMindMaps } from "@/lib/mindmaps";
import { MindMapList } from "@/components/mindmap/MindMapList";
import { getItemOrder } from "@/lib/item-order";

export const metadata = { title: "Cartes mentales" };

export default async function MindMapsPage() {
  const user = await requireUser();
  const [maps, order] = await Promise.all([listMindMaps(user.id), getItemOrder(user.id, "MINDMAP")]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <MindMapList initial={maps} order={order} />
    </div>
  );
}
