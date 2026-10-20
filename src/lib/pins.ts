import "server-only";
import type { PinKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { projectAccessWhere } from "@/lib/projects";
import { mapAccessWhere } from "@/lib/map-access";

/**
 * Épingles du menu de gauche : projets et cartes mentales, par utilisateur.
 * Une épingle ne vaut que si l'élément est toujours accessible (projet dont
 * je suis propriétaire ou membre, carte à moi ou partagée avec moi) : les
 * épingles devenues orphelines sont ignorées à la lecture et purgées.
 */

export type PinsDto = {
  projects: { id: string; name: string; color: string | null; icon?: string | null }[];
  mindmaps: { id: string; title: string; icon?: string | null }[];
};

const MAX_PINS = 30;

export async function listPins(userId: string): Promise<PinsDto> {
  const pins = await prisma.pin.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const projectIds = pins.filter((p) => p.kind === "PROJECT").map((p) => p.targetId);
  const mapIds = pins.filter((p) => p.kind === "MINDMAP").map((p) => p.targetId);
  const [projects, maps] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({ where: { id: { in: projectIds }, ...projectAccessWhere(userId) }, select: { id: true, name: true, color: true, icon: true } })
      : Promise.resolve([]),
    mapIds.length ? prisma.mindMap.findMany({ where: { AND: [{ id: { in: mapIds } }, mapAccessWhere(userId)] }, select: { id: true, title: true, icon: true } }) : Promise.resolve([]),
  ]);
  // Purge des épingles qui ne pointent plus vers un élément accessible.
  const stale = pins.filter((p) => (p.kind === "PROJECT" ? !projects.some((x) => x.id === p.targetId) : !maps.some((x) => x.id === p.targetId)));
  if (stale.length) {
    await prisma.pin.deleteMany({ where: { userId, OR: stale.map((p) => ({ kind: p.kind, targetId: p.targetId })) } });
  }
  // Ordre : mon ordre personnel (listes) d'abord, puis l'ordre d'épinglage.
  const ranks = new Map(
    (await prisma.itemOrder.findMany({ where: { userId, targetId: { in: pins.map((p) => p.targetId) } }, select: { kind: true, targetId: true, rank: true } })).map((r) => [`${r.kind}:${r.targetId}`, r.rank]),
  );
  const order = new Map(pins.map((p, i) => [`${p.kind}:${p.targetId}`, (ranks.get(`${p.kind}:${p.targetId}`) ?? 1_000_000) * 1000 + i]));
  return {
    projects: projects.sort((a, b) => order.get(`PROJECT:${a.id}`)! - order.get(`PROJECT:${b.id}`)!),
    mindmaps: maps.sort((a, b) => order.get(`MINDMAP:${a.id}`)! - order.get(`MINDMAP:${b.id}`)!),
  };
}

/** Épingle ou désépingle ; l'élément doit m'être accessible. Renvoie les épingles à jour. */
export async function setPin(userId: string, kind: PinKind, targetId: string, pinned: boolean): Promise<PinsDto> {
  if (pinned) {
    const ok =
      kind === "PROJECT"
        ? await prisma.project.findFirst({ where: { id: targetId, ...projectAccessWhere(userId) }, select: { id: true } })
        : await prisma.mindMap.findFirst({ where: { AND: [{ id: targetId }, mapAccessWhere(userId)] }, select: { id: true } });
    if (!ok) throw notFound(kind === "PROJECT" ? "Projet" : "Carte mentale");
    if ((await prisma.pin.count({ where: { userId } })) >= MAX_PINS) {
      const oldest = await prisma.pin.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
      if (oldest) await prisma.pin.delete({ where: { userId_kind_targetId: { userId, kind: oldest.kind, targetId: oldest.targetId } } });
    }
    await prisma.pin.upsert({ where: { userId_kind_targetId: { userId, kind, targetId } }, create: { userId, kind, targetId }, update: {} });
  } else {
    await prisma.pin.deleteMany({ where: { userId, kind, targetId } });
  }
  return listPins(userId);
}
