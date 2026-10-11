import { hierarchy, tree } from "d3-hierarchy";

/**
 * Mise en page automatique d'une carte mentale « classique » : racine au
 * centre, branches de premier niveau réparties à droite et à gauche
 * (alternance), sous-branches qui s'éloignent du centre. Les nœuds repliés
 * cachent leur descendance.
 *
 * Pur (aucune dépendance React) : testable et réutilisable côté mobile.
 */

export type LayoutNode = {
  id: string;
  parentId: string | null;
  title: string;
  collapsed: boolean;
  order: number;
};

export type Side = "left" | "right" | "root";

export type Positioned = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  side: Side;
  depth: number;
  /** Nombre de descendants cachés (nœud replié), 0 sinon. */
  hiddenCount: number;
};

export type LayoutEdge = { source: string; target: string; side: Side };

export const NODE_H = 40;
export const ROOT_H = 56;
const GAP_X = 72;
const GAP_Y = 16;

export function estimateWidth(title: string, isRoot: boolean): number {
  const chars = Math.max(4, title.length);
  const w = Math.min(260, chars * 7.4 + 36);
  return isRoot ? Math.min(300, w + 24) : w;
}

type H = { id: string; kids: H[] };

export function layoutMindMap(nodes: LayoutNode[], rootId: string): { positions: Map<string, Positioned>; edges: LayoutEdge[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);

  const countDescendants = (id: string): number =>
    (children.get(id) ?? []).reduce((acc, c) => acc + 1 + countDescendants(c.id), 0);

  const visibleKids = (id: string): LayoutNode[] => (byId.get(id)?.collapsed ? [] : (children.get(id) ?? []));

  const build = (id: string): H => ({ id, kids: visibleKids(id).map((k) => build(k.id)) });

  const positions = new Map<string, Positioned>();
  const edges: LayoutEdge[] = [];
  const root = byId.get(rootId);
  if (!root) return { positions, edges };

  const rootW = estimateWidth(root.title, true);
  positions.set(rootId, {
    id: rootId,
    x: -rootW / 2,
    y: -ROOT_H / 2,
    width: rootW,
    height: ROOT_H,
    side: "root",
    depth: 0,
    hiddenCount: root.collapsed ? countDescendants(rootId) : 0,
  });

  const firstLevel = visibleKids(rootId);
  const sides: Record<"right" | "left", H[]> = { right: [], left: [] };
  firstLevel.forEach((k, i) => sides[i % 2 === 0 ? "right" : "left"].push(build(k.id)));

  for (const side of ["right", "left"] as const) {
    if (sides[side].length === 0) continue;
    const h = hierarchy<H>({ id: rootId, kids: sides[side] }, (d) => d.kids);
    const layout = tree<H>()
      .nodeSize([NODE_H + GAP_Y, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.25));
    layout(h);

    // Largeur maximale par profondeur → abscisse de chaque colonne.
    const maxW = new Map<number, number>();
    h.each((d) => {
      if (d.depth === 0) return;
      const w = estimateWidth(byId.get(d.data.id)?.title ?? "", false);
      maxW.set(d.depth, Math.max(maxW.get(d.depth) ?? 0, w));
    });
    const colX: number[] = [rootW / 2];
    for (let depth = 1; depth <= (h.height ?? 0); depth++) {
      colX[depth] = colX[depth - 1] + (depth === 1 ? 0 : (maxW.get(depth - 1) ?? 0)) + GAP_X;
    }

    h.each((d) => {
      if (d.depth === 0) return;
      const n = byId.get(d.data.id)!;
      const width = estimateWidth(n.title, false);
      const xStart = colX[d.depth];
      positions.set(n.id, {
        id: n.id,
        x: side === "right" ? xStart : -xStart - width,
        y: (d.x ?? 0) - NODE_H / 2,
        width,
        height: NODE_H,
        side,
        depth: d.depth,
        hiddenCount: n.collapsed ? countDescendants(n.id) : 0,
      });
      edges.push({ source: d.parent!.data.id, target: n.id, side });
    });
  }

  return { positions, edges };
}

/** Identifiants du sous-arbre (nœud inclus). */
export function subtreeIds(nodes: LayoutNode[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}
