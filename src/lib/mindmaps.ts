import "server-only";
import type { NodeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { sanitizeNotes } from "@/lib/sanitize";
import type { CreateNodeInput, MoveNodeInput, UpdateNodeInput } from "@/lib/schemas";

/**
 * Logique métier des cartes mentales. Chaque fonction reçoit l'utilisateur
 * courant et vérifie la propriété de la carte (anti-IDOR) avant d'agir.
 *
 * Toute mutation s'exécute dans une transaction qui verrouille d'abord la
 * ligne de la carte (`SELECT … FOR UPDATE`) : les mutations concurrentes sur
 * une même carte (renommage + ajout de nœud envoyés coup sur coup par le
 * client) s'enchaînent au lieu de s'interbloquer.
 */

export type MindNodeDto = {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
  color: string | null;
  collapsed: boolean;
  /** OPEN · WATCH (à surveiller, mis en évidence) · CLOSED (fermé, hachuré, masqué par défaut). */
  status: NodeStatus;
  order: number;
  /** Position manuelle sur le canevas (null = automatique). */
  x: number | null;
  y: number | null;
  /** Tâches rattachées au nœud, et tâches non clôturées (terminées comprises). */
  taskCount: number;
  openTaskCount: number;
  updatedAt: string;
};

export type MindMapSummary = {
  id: string;
  title: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MindMapDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  rootId: string;
  nodes: MindNodeDto[];
};

type Tx = Prisma.TransactionClient;

type NodeRow = {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
  color: string | null;
  collapsed: boolean;
  status: NodeStatus;
  order: number;
  x: number | null;
  y: number | null;
  updatedAt: Date;
  tasks?: Array<{ task: { status: string } }>;
};

/** Inclusion des statuts des tâches rattachées (pour les compteurs du nœud). */
const NODE_INCLUDE = { tasks: { select: { task: { select: { status: true } } } } } satisfies Prisma.MindNodeInclude;

function toNodeDto(n: NodeRow): MindNodeDto {
  return {
    id: n.id,
    parentId: n.parentId,
    title: n.title,
    notes: sanitizeNotes(n.notes),
    color: n.color,
    collapsed: n.collapsed,
    status: n.status,
    order: n.order,
    x: n.x,
    y: n.y,
    taskCount: n.tasks?.length ?? 0,
    openTaskCount: n.tasks?.filter((t) => t.task.status !== "CLOSED").length ?? 0,
    updatedAt: n.updatedAt.toISOString(),
  };
}

async function ownedMap(userId: string, mapId: string) {
  const map = await prisma.mindMap.findFirst({ where: { id: mapId, ownerId: userId } });
  if (!map) throw notFound("Carte");
  return map;
}

/** Transaction sérialisée sur la carte : vérifie la propriété puis verrouille la ligne. */
async function mutateMap<T>(userId: string, mapId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await ownedMap(userId, mapId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MindMap" WHERE "id" = ${mapId} FOR UPDATE`;
      const result = await fn(tx);
      await tx.mindMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
      return result;
    },
    { timeout: 15_000 },
  );
}

export async function listMindMaps(userId: string): Promise<MindMapSummary[]> {
  const maps = await prisma.mindMap.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { nodes: true } } },
  });
  return maps.map((m) => ({
    id: m.id,
    title: m.title,
    nodeCount: m._count.nodes,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));
}

export async function createMindMap(userId: string, title: string): Promise<MindMapDto> {
  const map = await prisma.mindMap.create({
    data: { ownerId: userId, title, nodes: { create: { title, order: 0 } } },
  });
  return getMindMap(userId, map.id);
}

export async function getMindMap(userId: string, mapId: string): Promise<MindMapDto> {
  const map = await ownedMap(userId, mapId);
  const nodes = await prisma.mindNode.findMany({
    where: { mapId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: NODE_INCLUDE,
  });
  let root = nodes.find((n) => n.parentId === null);
  if (!root) {
    // Carte sans racine (ne devrait pas arriver) : on la répare.
    root = await prisma.mindNode.create({ data: { mapId, title: map.title, order: 0 }, include: NODE_INCLUDE });
    nodes.unshift(root);
  }
  return {
    id: map.id,
    title: map.title,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    rootId: root.id,
    nodes: nodes.map(toNodeDto),
  };
}

export async function updateMindMap(userId: string, mapId: string, data: { title?: string }): Promise<void> {
  await mutateMap(userId, mapId, async (tx) => {
    if (data.title) {
      await tx.mindMap.update({ where: { id: mapId }, data: { title: data.title } });
      await tx.mindNode.updateMany({ where: { mapId, parentId: null }, data: { title: data.title } });
    }
  });
}

export async function deleteMindMap(userId: string, mapId: string): Promise<void> {
  await ownedMap(userId, mapId);
  await prisma.mindMap.delete({ where: { id: mapId } });
}

/** Renumérote les enfants d'un parent de 0 à n-1, en insérant éventuellement `insertId` à `index`. */
async function resequence(tx: Tx, mapId: string, parentId: string, insertId?: string, index?: number) {
  const siblings = await tx.mindNode.findMany({
    where: { mapId, parentId, ...(insertId ? { NOT: { id: insertId } } : {}) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, order: true },
  });
  const ids = siblings.map((s) => s.id);
  if (insertId) {
    const at = index === undefined ? ids.length : Math.min(index, ids.length);
    ids.splice(at, 0, insertId);
  }
  const current = new Map(siblings.map((s) => [s.id, s.order]));
  for (let order = 0; order < ids.length; order++) {
    if (current.get(ids[order]) === order) continue;
    await tx.mindNode.update({ where: { id: ids[order] }, data: { order } });
  }
}

export async function createNode(userId: string, mapId: string, input: CreateNodeInput): Promise<MindNodeDto> {
  const node = await mutateMap(userId, mapId, async (tx) => {
    const parent = await tx.mindNode.findFirst({ where: { id: input.parentId, mapId } });
    if (!parent) throw notFound("Nœud parent");
    const created = await tx.mindNode.create({
      data: { mapId, parentId: parent.id, title: input.title, order: 1_000_000 },
    });
    await resequence(tx, mapId, parent.id, created.id, input.index);
    if (parent.collapsed) await tx.mindNode.update({ where: { id: parent.id }, data: { collapsed: false } });
    return tx.mindNode.findUniqueOrThrow({ where: { id: created.id }, include: NODE_INCLUDE });
  });
  return toNodeDto(node);
}

export async function updateNode(
  userId: string,
  mapId: string,
  nodeId: string,
  input: UpdateNodeInput,
): Promise<MindNodeDto> {
  const updated = await mutateMap(userId, mapId, async (tx) => {
    const node = await tx.mindNode.findFirst({ where: { id: nodeId, mapId } });
    if (!node) throw notFound("Nœud");
    const data: Prisma.MindNodeUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.notes !== undefined) data.notes = sanitizeNotes(input.notes);
    if (input.color !== undefined) data.color = input.color;
    if (input.collapsed !== undefined) data.collapsed = input.collapsed;
    if (input.status !== undefined) data.status = input.status;
    if (input.x !== undefined) data.x = input.x;
    if (input.y !== undefined) data.y = input.y;
    const row = await tx.mindNode.update({ where: { id: nodeId }, data, include: NODE_INCLUDE });
    if (node.parentId === null && input.title) {
      await tx.mindMap.update({ where: { id: mapId }, data: { title: input.title } });
    }
    return row;
  });
  return toNodeDto(updated);
}

/** « Affichage optimisé » : efface toutes les positions manuelles de la carte. */
export async function resetLayout(userId: string, mapId: string): Promise<MindMapDto> {
  await mutateMap(userId, mapId, async (tx) => {
    await tx.mindNode.updateMany({ where: { mapId }, data: { x: null, y: null } });
  });
  return getMindMap(userId, mapId);
}

export async function deleteNode(userId: string, mapId: string, nodeId: string): Promise<void> {
  await mutateMap(userId, mapId, async (tx) => {
    const node = await tx.mindNode.findFirst({ where: { id: nodeId, mapId } });
    if (!node) throw notFound("Nœud");
    if (node.parentId === null) throw badRequest("La racine ne peut pas être supprimée.");
    await tx.mindNode.delete({ where: { id: nodeId } });
    await resequence(tx, mapId, node.parentId);
  });
}

export async function moveNode(
  userId: string,
  mapId: string,
  nodeId: string,
  input: MoveNodeInput,
): Promise<MindNodeDto> {
  const moved = await mutateMap(userId, mapId, async (tx) => {
    const node = await tx.mindNode.findFirst({ where: { id: nodeId, mapId } });
    if (!node) throw notFound("Nœud");
    if (node.parentId === null) throw badRequest("La racine ne peut pas être déplacée.");
    const target = await tx.mindNode.findFirst({ where: { id: input.parentId, mapId } });
    if (!target) throw notFound("Nœud cible");
    if (target.id === node.id) throw badRequest("Un nœud ne peut pas être son propre parent.");

    // Interdit : déplacer un nœud dans sa propre descendance.
    const all = await tx.mindNode.findMany({ where: { mapId }, select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((n) => [n.id, n.parentId]));
    for (let cur: string | null = target.parentId; cur; cur = parentOf.get(cur) ?? null) {
      if (cur === node.id) throw badRequest("Impossible de déplacer un nœud dans sa propre branche.");
    }

    const oldParentId = node.parentId;
    await tx.mindNode.update({ where: { id: nodeId }, data: { parentId: target.id, order: 1_000_000 } });
    await resequence(tx, mapId, target.id, nodeId, input.index);
    if (oldParentId !== target.id) await resequence(tx, mapId, oldParentId);
    if (target.collapsed) await tx.mindNode.update({ where: { id: target.id }, data: { collapsed: false } });
    return tx.mindNode.findUniqueOrThrow({ where: { id: nodeId }, include: NODE_INCLUDE });
  });
  return toNodeDto(moved);
}
