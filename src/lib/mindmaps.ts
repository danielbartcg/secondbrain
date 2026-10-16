import "server-only";
import type { NodeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { sanitizeNotes } from "@/lib/sanitize";
import { taskAccessWhere } from "@/lib/projects";
import type { CreateNodeInput, MoveNodeInput, UpdateNodeInput } from "@/lib/schemas";
import { mapAccessWhere, requireMapAccess } from "@/lib/map-access";
import { mapAccessOf, type MapAccess, type MapOwnerRef } from "@/lib/shared/map-access";
import { NODE_STATUS_LABEL, q, recordMapEvents, type MapEventInput } from "@/lib/map-events";
import { actorDisplayName } from "@/lib/task-events";

export { mapAccessWhere, mapWriteWhere, requireMapAccess } from "@/lib/map-access";
export type { MapAccess, MapOwnerRef } from "@/lib/shared/map-access";

/**
 * Logique métier des cartes mentales. Chaque fonction reçoit l'utilisateur
 * courant et vérifie son droit sur la carte (anti-IDOR) avant d'agir :
 * lecture (propriétaire ou partage), écriture (propriétaire ou partage en
 * écriture : nœuds, notes, mise en page, titre), propriétaire (supprimer la
 * carte, gérer les partages — src/lib/map-shares.ts).
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

/** Champs de partage communs à la liste et à la carte complète. */
export type MindMapSharing = {
  /** Mon droit sur la carte. */
  access: MapAccess;
  /** Propriétaire (qui me l'a partagée) ; null quand la carte est à moi. */
  owner: MapOwnerRef | null;
  /** Nombre de personnes avec qui la carte est partagée (vue propriétaire ; 0 sinon). */
  sharedWith: number;
};

export type MindMapSummary = {
  id: string;
  title: string;
  /** Carte type (modèle, Administration → Modèles). */
  isTemplate: boolean;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
} & MindMapSharing;

export type MindMapDto = {
  id: string;
  title: string;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  rootId: string;
  nodes: MindNodeDto[];
} & MindMapSharing;

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

/**
 * Inclusion des statuts des tâches rattachées (pour les compteurs du nœud) :
 * seulement celles auxquelles l'utilisateur a accès (pas de fuite de tâches
 * d'un projet qu'il a quitté).
 */
function nodeInclude(userId: string) {
  return { tasks: { where: { task: taskAccessWhere(userId) }, select: { task: { select: { status: true } } } } } satisfies Prisma.MindNodeInclude;
}

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

/** Requête des informations de partage d'une carte, vues par `userId`. */
function sharingInclude(userId: string) {
  return {
    owner: { select: { id: true, name: true, avatarUrl: true } },
    shares: { where: { userId }, select: { permission: true } },
    _count: { select: { shares: true } },
  } satisfies Prisma.MindMapInclude;
}

function toSharing(
  userId: string,
  m: { ownerId: string; owner: MapOwnerRef; shares: Array<{ permission: "READ" | "WRITE" }>; _count: { shares: number } },
): MindMapSharing {
  const access = mapAccessOf(m.ownerId, userId, m.shares[0]?.permission) ?? "read";
  return {
    access,
    owner: access === "owner" ? null : { id: m.owner.id, name: m.owner.name, avatarUrl: m.owner.avatarUrl },
    sharedWith: access === "owner" ? m._count.shares : 0,
  };
}

/**
 * Transaction sérialisée sur la carte : vérifie le droit d'écriture puis
 * verrouille la ligne (toute écriture du contenu passe par ici).
 */
async function mutateMap<T>(userId: string, mapId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await requireMapAccess(userId, mapId, "write");
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

/** Mes cartes et celles qu'on m'a partagées (lecture ou écriture), les plus récentes d'abord. */
export async function listMindMaps(userId: string): Promise<MindMapSummary[]> {
  const maps = await prisma.mindMap.findMany({
    where: mapAccessWhere(userId),
    orderBy: { updatedAt: "desc" },
    include: { ...sharingInclude(userId), _count: { select: { nodes: true, shares: true } } },
  });
  return maps.map((m) => ({
    id: m.id,
    title: m.title,
    isTemplate: m.isTemplate,
    nodeCount: m._count.nodes,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    ...toSharing(userId, m),
  }));
}

/** `ids` : identifiants générés hors ligne par une application (carte et nœud racine). */
export async function createMindMap(userId: string, title: string, ids: { id?: string; rootId?: string } = {}): Promise<MindMapDto> {
  const map = await prisma.$transaction(async (tx) => {
    const m = await tx.mindMap.create({
      data: { id: ids.id, ownerId: userId, title, nodes: { create: { id: ids.rootId, title, order: 0 } } },
    });
    const actor = await actorDisplayName(tx, userId);
    await recordMapEvents(tx, [{ mapId: m.id, actorId: userId, actorName: actor, kind: "created", newValue: title, message: `${actor} a créé la carte ${q(title)}` }]);
    return m;
  });
  return getMindMap(userId, map.id);
}

export async function getMindMap(userId: string, mapId: string): Promise<MindMapDto> {
  await requireMapAccess(userId, mapId, "read");
  const map = await prisma.mindMap.findUniqueOrThrow({ where: { id: mapId }, include: sharingInclude(userId) });
  const nodes = await prisma.mindNode.findMany({
    where: { mapId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: nodeInclude(userId),
  });
  let root = nodes.find((n) => n.parentId === null);
  if (!root) {
    // Carte sans racine (ne devrait pas arriver) : on la répare.
    root = await prisma.mindNode.create({ data: { mapId, title: map.title, order: 0 }, include: nodeInclude(userId) });
    nodes.unshift(root);
  }
  return {
    id: map.id,
    title: map.title,
    isTemplate: map.isTemplate,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    rootId: root.id,
    nodes: nodes.map(toNodeDto),
    ...toSharing(userId, map),
  };
}

export async function updateMindMap(userId: string, mapId: string, data: { title?: string }): Promise<void> {
  await mutateMap(userId, mapId, async (tx) => {
    if (data.title) {
      const before = await tx.mindMap.findUniqueOrThrow({ where: { id: mapId }, select: { title: true } });
      await tx.mindMap.update({ where: { id: mapId }, data: { title: data.title } });
      await tx.mindNode.updateMany({ where: { mapId, parentId: null }, data: { title: data.title } });
      if (before.title !== data.title) {
        const actor = await actorDisplayName(tx, userId);
        await recordMapEvents(tx, [{ mapId, actorId: userId, actorName: actor, kind: "renamed", oldValue: before.title, newValue: data.title, message: `${actor} a renommé la carte ${q(before.title)} en ${q(data.title)}` }]);
      }
    }
  });
}

/** Suppression : propriétaire seulement (les partages disparaissent avec la carte). */
export async function deleteMindMap(userId: string, mapId: string): Promise<void> {
  await requireMapAccess(userId, mapId, "owner");
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

export async function createNode(userId: string, mapId: string, input: CreateNodeInput, id?: string): Promise<MindNodeDto> {
  const node = await mutateMap(userId, mapId, async (tx) => {
    const parent = await tx.mindNode.findFirst({ where: { id: input.parentId, mapId } });
    if (!parent) throw notFound("Nœud parent");
    const created = await tx.mindNode.create({
      data: { id, mapId, parentId: parent.id, title: input.title, order: 1_000_000 },
    });
    await resequence(tx, mapId, parent.id, created.id, input.index);
    if (parent.collapsed) await tx.mindNode.update({ where: { id: parent.id }, data: { collapsed: false } });
    const actor = await actorDisplayName(tx, userId);
    await recordMapEvents(tx, [{ mapId, nodeId: created.id, nodeTitle: created.title, actorId: userId, actorName: actor, kind: "node_created", newValue: created.title, message: `${actor} a ajouté le nœud ${q(created.title)} sous ${q(parent.title)}` }]);
    return tx.mindNode.findUniqueOrThrow({ where: { id: created.id }, include: nodeInclude(userId) });
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
    const row = await tx.mindNode.update({ where: { id: nodeId }, data, include: nodeInclude(userId) });
    if (node.parentId === null && input.title) {
      await tx.mindMap.update({ where: { id: mapId }, data: { title: input.title } });
    }
    // Piste d'audit (positions et repli non journalisés).
    const events: MapEventInput[] = [];
    let actor: string | null = null;
    const who = async () => (actor ??= await actorDisplayName(tx, userId));
    const base = { mapId, nodeId, nodeTitle: row.title, actorId: userId };
    if (input.title !== undefined && input.title !== node.title) {
      const a = await who();
      events.push({ ...base, actorName: a, kind: node.parentId === null ? "renamed" : "node_renamed", oldValue: node.title, newValue: input.title, message: node.parentId === null ? `${a} a renommé la carte ${q(node.title)} en ${q(input.title)}` : `${a} a renommé le nœud ${q(node.title)} en ${q(input.title)}` });
    }
    if (input.notes !== undefined && data.notes !== node.notes) {
      const a = await who();
      events.push({ ...base, actorName: a, kind: "node_notes", message: `${a} a modifié les notes du nœud ${q(row.title)}` });
    }
    if (input.status !== undefined && input.status !== node.status) {
      const a = await who();
      events.push({ ...base, actorName: a, kind: "node_status", oldValue: node.status, newValue: input.status, message: `${a} a passé le nœud ${q(row.title)} de « ${NODE_STATUS_LABEL[node.status] ?? node.status} » à « ${NODE_STATUS_LABEL[input.status] ?? input.status} »` });
    }
    if (input.color !== undefined && input.color !== node.color) {
      const a = await who();
      events.push({ ...base, actorName: a, kind: "node_color", oldValue: node.color, newValue: input.color, message: `${a} a changé la couleur du nœud ${q(row.title)}` });
    }
    await recordMapEvents(tx, events);
    return row;
  });
  return toNodeDto(updated);
}

/** « Affichage optimisé » : efface toutes les positions manuelles de la carte. */
export async function resetLayout(userId: string, mapId: string): Promise<MindMapDto> {
  await mutateMap(userId, mapId, async (tx) => {
    await tx.mindNode.updateMany({ where: { mapId }, data: { x: null, y: null } });
    const actor = await actorDisplayName(tx, userId);
    await recordMapEvents(tx, [{ mapId, actorId: userId, actorName: actor, kind: "layout_reset", message: `${actor} a rétabli l'affichage optimisé de la carte` }]);
  });
  return getMindMap(userId, mapId);
}

export async function deleteNode(userId: string, mapId: string, nodeId: string): Promise<void> {
  await mutateMap(userId, mapId, async (tx) => {
    const node = await tx.mindNode.findFirst({ where: { id: nodeId, mapId } });
    if (!node) throw notFound("Nœud");
    if (node.parentId === null) throw badRequest("La racine ne peut pas être supprimée.");
    // Taille de la branche supprimée (pour l'historique).
    const all = await tx.mindNode.findMany({ where: { mapId }, select: { id: true, parentId: true } });
    const kids = new Map<string, string[]>();
    for (const n of all) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
    let below = 0;
    for (const stack = [...(kids.get(nodeId) ?? [])]; stack.length; below++) stack.push(...(kids.get(stack.pop()!) ?? []));
    const actor = await actorDisplayName(tx, userId);
    await recordMapEvents(tx, [{ mapId, nodeId, nodeTitle: node.title, actorId: userId, actorName: actor, kind: "node_deleted", oldValue: node.title, message: `${actor} a supprimé le nœud ${q(node.title)}${below ? ` et ses ${below} sous-nœud${below > 1 ? "s" : ""}` : ""}` }]);
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
    if (oldParentId !== target.id) {
      const from = await tx.mindNode.findUnique({ where: { id: oldParentId }, select: { title: true } });
      const actor = await actorDisplayName(tx, userId);
      await recordMapEvents(tx, [{ mapId, nodeId, nodeTitle: node.title, actorId: userId, actorName: actor, kind: "node_moved", oldValue: from?.title ?? null, newValue: target.title, message: `${actor} a déplacé le nœud ${q(node.title)} de ${q(from?.title)} vers ${q(target.title)}` }]);
    }
    await tx.mindNode.update({ where: { id: nodeId }, data: { parentId: target.id, order: 1_000_000 } });
    await resequence(tx, mapId, target.id, nodeId, input.index);
    if (oldParentId !== target.id) await resequence(tx, mapId, oldParentId);
    if (target.collapsed) await tx.mindNode.update({ where: { id: target.id }, data: { collapsed: false } });
    return tx.mindNode.findUniqueOrThrow({ where: { id: nodeId }, include: nodeInclude(userId) });
  });
  return toNodeDto(moved);
}
