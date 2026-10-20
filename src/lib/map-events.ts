import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMapAccess } from "@/lib/map-access";

/**
 * Piste d'audit des cartes mentales (MapEvent), sur le modèle de celle des
 * tâches (`task-events.ts`) : une ligne par modification, message lisible figé
 * au moment de l'action (« Alice a renommé le nœud « Idée » en « Piste » »).
 * Toujours appelée **dans la transaction** de la modification.
 *
 * Non journalisés (bruit) : positions manuelles sur le canevas, repli / dépli.
 * Notes : les enregistrements automatiques successifs d'un même auteur sur un
 * même nœud sont regroupés (une ligne par séance de 10 minutes).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type MapEventKind =
  | "created"
  | "renamed"
  | "icon"
  | "node_created"
  | "node_renamed"
  | "node_notes"
  | "node_status"
  | "node_color"
  | "node_moved"
  | "node_deleted"
  | "node_attachment"
  | "task_linked"
  | "task_unlinked"
  | "shared"
  | "share_changed"
  | "unshared"
  | "left"
  | "layout_reset";

export type MapEventInput = {
  mapId: string;
  nodeId?: string | null;
  nodeTitle?: string | null;
  actorId: string | null;
  actorName: string;
  kind: MapEventKind;
  oldValue?: string | null;
  newValue?: string | null;
  message: string;
};

export type MapEventDto = {
  id: string;
  kind: string;
  nodeId: string | null;
  nodeTitle: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  actorId: string | null;
  actorName: string;
  actorAvatarUrl: string | null;
  createdAt: string;
};

const NOTES_SESSION_MS = 10 * 60 * 1000;

export async function recordMapEvents(db: Db, events: MapEventInput[]): Promise<void> {
  const rows: Prisma.MapEventCreateManyInput[] = [];
  for (const e of events) {
    if (e.kind === "node_notes" && e.nodeId) {
      // Séance d'écriture en cours (même auteur, même nœud) : on la prolonge.
      const last = await db.mapEvent.findFirst({
        where: { mapId: e.mapId, nodeId: e.nodeId, kind: "node_notes", actorId: e.actorId, createdAt: { gte: new Date(Date.now() - NOTES_SESSION_MS) } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (last) {
        await db.mapEvent.update({ where: { id: last.id }, data: { createdAt: new Date(), nodeTitle: e.nodeTitle ?? undefined } });
        continue;
      }
    }
    rows.push({
      mapId: e.mapId,
      nodeId: e.nodeId ?? null,
      nodeTitle: e.nodeTitle?.slice(0, 300) ?? null,
      actorId: e.actorId,
      actorName: e.actorName,
      kind: e.kind,
      oldValue: e.oldValue?.slice(0, 2000) ?? null,
      newValue: e.newValue?.slice(0, 2000) ?? null,
      message: e.message.slice(0, 1000),
    });
  }
  if (rows.length) await db.mapEvent.createMany({ data: rows });
}

/** « « titre » » tronqué pour les messages. */
export function q(title: string | null | undefined): string {
  const t = (title ?? "").trim() || "sans titre";
  return `« ${t.length > 80 ? t.slice(0, 79) + "…" : t} »`;
}

export const NODE_STATUS_LABEL: Record<string, string> = { OPEN: "ouvert", WATCH: "à surveiller", CLOSED: "fermé" };

/** Historique d'une carte (lecture) ; `nodeId` : limité à un nœud. Plus récents d'abord. */
export async function listMapEvents(userId: string, mapId: string, opts: { nodeId?: string; limit?: number } = {}): Promise<MapEventDto[]> {
  await requireMapAccess(userId, mapId, "read");
  const rows = await prisma.mapEvent.findMany({
    where: { mapId, ...(opts.nodeId ? { nodeId: opts.nodeId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(1000, Math.max(1, opts.limit ?? 300)),
    include: { actor: { select: { avatarUrl: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    nodeId: r.nodeId,
    nodeTitle: r.nodeTitle,
    oldValue: r.oldValue,
    newValue: r.newValue,
    message: r.message,
    actorId: r.actorId,
    actorName: r.actorName,
    actorAvatarUrl: r.actor?.avatarUrl ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
