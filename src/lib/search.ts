import "server-only";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere, taskAccessWhere, taskHref } from "@/lib/projects";
import { NO_PROJECT_LABEL } from "@/lib/tasks";

/**
 * Recherche globale (auto-complétion de la page d'accueil) : projets, tâches,
 * nœuds de carte mentale et cartes accessibles à l'utilisateur, sur le
 * titre / nom et la description / les notes (insensible à la casse).
 * Chaque résultat porte le lien de la page dédiée.
 */

export type SearchKind = "project" | "task" | "node" | "mindmap";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Contexte (projet › étape, carte, extrait…). */
  subtitle: string;
  href: string;
  status?: string;
  color?: string | null;
};

const ALL_KINDS: SearchKind[] = ["project", "task", "node", "mindmap"];

/** Texte brut d'une note HTML, tronqué autour de la première occurrence. */
function excerpt(html: string, q: string, len = 90): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, idx - 30);
  const slice = text.slice(start, start + len);
  return (start > 0 ? "…" : "") + slice + (start + len < text.length ? "…" : "");
}

export async function search(
  userId: string,
  rawQuery: string,
  options: { kinds?: SearchKind[]; limitPerKind?: number } = {},
): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  const kinds = options.kinds?.length ? options.kinds.filter((k) => ALL_KINDS.includes(k)) : ALL_KINDS;
  const take = Math.min(20, Math.max(1, options.limitPerKind ?? 6));
  const contains = { contains: q, mode: "insensitive" as const };
  const hits: SearchHit[] = [];

  if (kinds.includes("project")) {
    const rows = await prisma.project.findMany({
      where: { ...projectAccessWhere(userId), OR: [{ name: contains }, { description: contains }] },
      orderBy: { updatedAt: "desc" },
      take,
      select: { id: true, name: true, description: true, status: true, color: true },
    });
    for (const p of rows) hits.push({ kind: "project", id: p.id, title: p.name, subtitle: excerpt(p.description, q) || "Projet", href: `/projects/${p.id}`, status: p.status, color: p.color });
  }
  if (kinds.includes("task")) {
    const rows = await prisma.task.findMany({
      where: { AND: [taskAccessWhere(userId), { OR: [{ name: contains }, { description: contains }] }] },
      orderBy: { updatedAt: "desc" },
      take,
      select: { id: true, name: true, description: true, status: true, project: { select: { name: true, color: true } }, stage: { select: { name: true } } },
    });
    for (const t of rows) {
      const ctx = [t.project?.name ?? NO_PROJECT_LABEL, t.stage?.name].filter(Boolean).join(" › ");
      const ex = excerpt(t.description, q);
      hits.push({ kind: "task", id: t.id, title: t.name, subtitle: ex && !t.name.toLowerCase().includes(q.toLowerCase()) ? `${ctx} — ${ex}` : ctx, href: taskHref(t.id), status: t.status, color: t.project?.color ?? null });
    }
  }
  if (kinds.includes("node")) {
    const rows = await prisma.mindNode.findMany({
      where: { map: { ownerId: userId }, parentId: { not: null }, OR: [{ title: contains }, { notes: contains }] },
      orderBy: { updatedAt: "desc" },
      take,
      select: { id: true, title: true, notes: true, status: true, mapId: true, map: { select: { title: true } } },
    });
    for (const n of rows) {
      const ex = excerpt(n.notes, q);
      hits.push({
        kind: "node",
        id: n.id,
        title: n.title,
        subtitle: ex && !n.title.toLowerCase().includes(q.toLowerCase()) ? `${n.map.title} — ${ex}` : `Carte « ${n.map.title} »`,
        href: `/mindmaps/${n.mapId}?node=${n.id}`,
        status: n.status,
      });
    }
  }
  if (kinds.includes("mindmap")) {
    const rows = await prisma.mindMap.findMany({ where: { ownerId: userId, title: contains }, orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true } });
    for (const m of rows) hits.push({ kind: "mindmap", id: m.id, title: m.title, subtitle: "Carte mentale", href: `/mindmaps/${m.id}` });
  }
  return hits;
}
