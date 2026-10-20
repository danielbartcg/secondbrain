import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { projectAccessWhere } from "@/lib/projects";
import { mapAccessWhere } from "@/lib/map-access";
import {
  createActivity,
  createProject,
  createStage,
  createTask,
  deleteActivity,
  deleteProject,
  deleteStage,
  deleteTask,
  updateActivity,
  updateProject,
  updateStage,
  updateTask,
} from "@/lib/projects";
import { createMindMap, createNode, deleteMindMap, deleteNode, moveNode, updateMindMap, updateNode } from "@/lib/mindmaps";
import { addComment, addWorkSession, deleteComment, deleteWorkSession, linkNodeTask, unlinkNodeTask } from "@/lib/tasks";
import { saveNotes } from "@/lib/notes";
import {
  createActivitySchema,
  createMindMapSchema,
  createNodeSchema,
  createProjectSchema,
  createStageSchema,
  createTaskSchema,
  updateActivitySchema,
  updateMindMapSchema,
  updateNodeSchema,
  updateProjectSchema,
  updateStageSchema,
  updateTaskSchema,
  type SyncOpInput,
} from "@/lib/schemas";
import { z } from "zod";

/**
 * Synchronisation hors ligne des applications desktop / iPhone
 * (docs/05-offline-sync.md).
 *
 *  - Toute écriture sur une table synchronisée est journalisée par un
 *    déclencheur PostgreSQL dans `SyncLog` (création, champ modifié,
 *    suppression), qu'elle vienne du web ou d'une application.
 *  - `pull` : instantané du périmètre (premier lancement), puis changements
 *    depuis un curseur, avec la version (`seq`) de chaque champ.
 *  - `push` : rejoue les opérations faites hors ligne **par les fonctions
 *    métier existantes** (accès, invariants, notifications). Conflit par
 *    champ : un champ n'est appliqué que si personne ne l'a modifié depuis la
 *    version connue du client ; sinon la valeur serveur est conservée et
 *    renvoyée. Une suppression est refusée si l'objet a changé depuis.
 *  - Version du protocole : une application incompatible reçoit 426 et doit
 *    simplement être mise à jour.
 */

/** À incrémenter à chaque changement incompatible du protocole ou des données synchronisées. */
export const SYNC_PROTOCOL_VERSION = 2;

export function assertProtocol(version: string | null) {
  if (Number(version) !== SYNC_PROTOCOL_VERSION) {
    throw new ApiError(426, "UPGRADE_REQUIRED", "Cette version de l'application n'est plus compatible : mettez-la à jour.", { serverVersion: SYNC_PROTOCOL_VERSION });
  }
}

export type SyncEntity =
  | "MindMap"
  | "MindNode"
  | "MindNodeTask"
  | "MindMapShare"
  | "Project"
  | "ProjectMember"
  | "Stage"
  | "Activity"
  | "Task"
  | "TaskContributor"
  | "WorkSession"
  | "TaskComment"
  | "Deliverable"
  | "Document"
  | "Folder";

type Row = Record<string, unknown>;
export type FieldSeqs = Record<string, number>;
export type SyncChange = { entity: SyncEntity; id: string; op: "upsert" | "delete"; data?: Row; seqs?: FieldSeqs };
export type SyncScope = { projectIds: string[]; mapIds: string[] };
export type PullResult = { protocol: number; cursor: number | null; hasMore: boolean; snapshot: boolean; scope: SyncScope; changes: SyncChange[] };

// --- Lecture des lignes ------------------------------------------------------------

/** Sérialisation JSON d'une ligne (dates ISO ; colonnes internes retirées). */
function serialize(entity: SyncEntity, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (entity === "Document" && k === "storagePath") continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

const compositeId = (entity: SyncEntity, row: Row) =>
  entity === "MindNodeTask"
    ? `${row.nodeId}:${row.taskId}`
    : entity === "TaskContributor"
      ? `${row.taskId}:${row.memberId}`
      : entity === "MindMapShare"
        ? `${row.mapId}:${row.userId}`
        : String(row.id);

/**
 * Lignes MindMap enrichies du nom et de la photo du propriétaire
 * (`ownerName`, `ownerAvatarUrl`, champs dérivés non journalisés) : une
 * carte partagée affiche « partagée par … » hors ligne.
 */
async function mindMapRows(where: Prisma.MindMapWhereInput): Promise<Row[]> {
  const rows = await prisma.mindMap.findMany({ where, include: { owner: { select: { name: true, avatarUrl: true } } } });
  return rows.map(({ owner, ...m }) => ({ ...m, ownerName: owner.name, ownerAvatarUrl: owner.avatarUrl }));
}

/**
 * Membres et commentaires enrichis du nom et de la photo du compte
 * (`userName` / `userAvatarUrl`, `authorName` / `authorAvatarUrl` : champs
 * dérivés non journalisés) : l'application affiche les autres personnes
 * comme le site.
 */
async function memberRows(where: Prisma.ProjectMemberWhereInput): Promise<Row[]> {
  const rows = await prisma.projectMember.findMany({ where, include: { user: { select: { name: true, avatarUrl: true } } } });
  return rows.map(({ user, ...m }) => ({ ...m, userName: user?.name ?? null, userAvatarUrl: user?.avatarUrl ?? null }));
}
async function commentRows(where: Prisma.TaskCommentWhereInput): Promise<Row[]> {
  const rows = await prisma.taskComment.findMany({ where, include: { author: { select: { name: true, avatarUrl: true } } } });
  return rows.map(({ author, ...c }) => ({ ...c, authorName: author.name, authorAvatarUrl: author.avatarUrl }));
}

/** Lignes courantes d'une entité, par identifiant. */
async function fetchRows(entity: SyncEntity, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (ids.length === 0) return out;
  let rows: Row[] = [];
  switch (entity) {
    case "MindMap":
      rows = await mindMapRows({ id: { in: ids } });
      break;
    case "MindMapShare":
      rows = await prisma.mindMapShare.findMany({ where: { OR: ids.map((i) => ({ mapId: i.split(":")[0], userId: i.split(":")[1] })) } });
      break;
    case "MindNode":
      rows = await prisma.mindNode.findMany({ where: { id: { in: ids } } });
      break;
    case "MindNodeTask":
      rows = await prisma.mindNodeTask.findMany({ where: { OR: ids.map((i) => ({ nodeId: i.split(":")[0], taskId: i.split(":")[1] })) } });
      break;
    case "Project":
      rows = await prisma.project.findMany({ where: { id: { in: ids } } });
      break;
    case "ProjectMember":
      rows = await memberRows({ id: { in: ids } });
      break;
    case "Stage":
      rows = await prisma.stage.findMany({ where: { id: { in: ids } } });
      break;
    case "Activity":
      rows = await prisma.activity.findMany({ where: { id: { in: ids } } });
      break;
    case "Task":
      rows = await prisma.task.findMany({ where: { id: { in: ids } } });
      break;
    case "TaskContributor":
      rows = await prisma.taskContributor.findMany({ where: { OR: ids.map((i) => ({ taskId: i.split(":")[0], memberId: i.split(":")[1] })) } });
      break;
    case "WorkSession":
      rows = await prisma.workSession.findMany({ where: { id: { in: ids } } });
      break;
    case "TaskComment":
      rows = await commentRows({ id: { in: ids } });
      break;
    case "Deliverable":
      rows = await prisma.deliverable.findMany({ where: { id: { in: ids } } });
      break;
    case "Document":
      rows = await prisma.document.findMany({ where: { id: { in: ids } } });
      break;
    case "Folder":
      rows = await prisma.folder.findMany({ where: { id: { in: ids } } });
      break;
  }
  for (const r of rows) out.set(compositeId(entity, r), r);
  return out;
}

/** Versions (seq) par champ ; "*" = création. Un champ jamais modifié a la version de création. */
async function fieldSeqs(entityIds: string[]): Promise<Map<string, FieldSeqs>> {
  const out = new Map<string, FieldSeqs>();
  if (entityIds.length === 0) return out;
  const rows = await prisma.$queryRaw<Array<{ entity: string; entityId: string; field: string | null; seq: bigint }>>`
    SELECT "entity", "entityId", "field", MAX("seq") AS "seq" FROM "SyncLog"
    WHERE "entityId" = ANY(${entityIds}::text[]) AND "op" = 'UPSERT'
    GROUP BY "entity", "entityId", "field"`;
  for (const r of rows) {
    const key = `${r.entity}|${r.entityId}`;
    const s = out.get(key) ?? {};
    s[r.field ?? "*"] = Number(r.seq);
    out.set(key, s);
  }
  return out;
}

/** Version courante d'un champ (sa dernière écriture, sinon la création, sinon 0). */
export function seqOf(seqs: FieldSeqs | undefined, field: string): number {
  if (!seqs) return 0;
  return Math.max(seqs[field] ?? 0, seqs["*"] ?? 0);
}

/** Version courante de l'objet entier (dernière écriture, quel que soit le champ). */
function maxSeq(seqs: FieldSeqs | undefined): number {
  return seqs ? Math.max(0, ...Object.values(seqs)) : 0;
}

// --- Périmètre et visibilité ---------------------------------------------------------

async function scopeOf(userId: string): Promise<SyncScope> {
  const [projects, maps] = await Promise.all([
    prisma.project.findMany({ where: projectAccessWhere(userId), select: { id: true } }),
    prisma.mindMap.findMany({ where: mapAccessWhere(userId), select: { id: true } }),
  ]);
  return { projectIds: projects.map((p) => p.id), mapIds: maps.map((m) => m.id) };
}

/** Filtre les lignes réellement visibles par l'utilisateur (défense en profondeur). */
async function visibleRows(userId: string, scope: SyncScope, entity: SyncEntity, rows: Map<string, Row>): Promise<Map<string, Row>> {
  const pids = new Set(scope.projectIds);
  const mids = new Set(scope.mapIds);
  const out = new Map<string, Row>();
  const taskVisible = (t: { projectId: unknown; ownerId: unknown } | undefined) => !!t && (t.projectId ? pids.has(String(t.projectId)) : t.ownerId === userId);

  if (entity === "Activity") {
    const stages = await prisma.stage.findMany({ where: { id: { in: [...rows.values()].map((r) => String(r.stageId)) } }, select: { id: true, projectId: true } });
    const pOf = new Map(stages.map((s) => [s.id, s.projectId]));
    for (const [id, r] of rows) if (pids.has(pOf.get(String(r.stageId)) ?? "")) out.set(id, r);
    return out;
  }
  if (entity === "TaskContributor" || entity === "WorkSession" || entity === "TaskComment") {
    const tasks = await prisma.task.findMany({ where: { id: { in: [...rows.values()].map((r) => String(r.taskId)) } }, select: { id: true, projectId: true, ownerId: true } });
    const tOf = new Map(tasks.map((t) => [t.id, t]));
    for (const [id, r] of rows) if (taskVisible(tOf.get(String(r.taskId)))) out.set(id, r);
    return out;
  }
  if (entity === "MindMapShare") {
    // Le propriétaire voit tous les partages de sa carte ; un destinataire, seulement le sien.
    const maps = await prisma.mindMap.findMany({ where: { id: { in: [...rows.values()].map((r) => String(r.mapId)) } }, select: { id: true, ownerId: true } });
    const ownerOf = new Map(maps.map((m) => [m.id, m.ownerId]));
    for (const [id, r] of rows) if (mids.has(String(r.mapId)) && (ownerOf.get(String(r.mapId)) === userId || r.userId === userId)) out.set(id, r);
    return out;
  }
  if (entity === "MindNodeTask") {
    const nodes = await prisma.mindNode.findMany({ where: { id: { in: [...rows.values()].map((r) => String(r.nodeId)) } }, select: { id: true, mapId: true } });
    const mOf = new Map(nodes.map((n) => [n.id, n.mapId]));
    for (const [id, r] of rows) if (mids.has(mOf.get(String(r.nodeId)) ?? "")) out.set(id, r);
    return out;
  }
  for (const [id, r] of rows) {
    const ok =
      entity === "MindMap" ? mids.has(String(r.id))
      : entity === "MindNode" ? mids.has(String(r.mapId))
      : entity === "Project" ? pids.has(String(r.id))
      : entity === "Task" ? taskVisible(r as { projectId: unknown; ownerId: unknown })
      : pids.has(String(r.projectId)); // ProjectMember, Stage, Deliverable, Document, Folder
    if (ok) out.set(id, r);
  }
  return out;
}

async function currentCursor(): Promise<number> {
  const r = await prisma.syncLog.aggregate({ _max: { seq: true } });
  return Number(r._max.seq ?? 0);
}

// --- Pull ------------------------------------------------------------------------------

/**
 * Instantané complet du périmètre (premier lancement), ou d'un seul projet /
 * d'une seule carte qui vient d'entrer dans le périmètre (`only`).
 */
export async function snapshot(userId: string, only?: { projectId?: string; mapId?: string }): Promise<PullResult> {
  const cursor = only ? null : await currentCursor(); // lu AVANT les données : rien n'est perdu
  const scope = await scopeOf(userId);
  const pids = only ? (only.projectId && scope.projectIds.includes(only.projectId) ? [only.projectId] : []) : scope.projectIds;
  const mids = only ? (only.mapId && scope.mapIds.includes(only.mapId) ? [only.mapId] : []) : scope.mapIds;
  if (only && pids.length === 0 && mids.length === 0) throw notFound("Élément");

  const [maps, shares, nodes, links, projects, members, stages, activities, tasks, deliverables, documents, folders] = await Promise.all([
    mindMapRows({ id: { in: mids } }),
    prisma.mindMapShare.findMany({ where: { mapId: { in: mids }, OR: [{ userId }, { map: { ownerId: userId } }] } }),
    prisma.mindNode.findMany({ where: { mapId: { in: mids } } }),
    prisma.mindNodeTask.findMany({ where: { node: { mapId: { in: mids } } } }),
    prisma.project.findMany({ where: { id: { in: pids } } }),
    memberRows({ projectId: { in: pids } }),
    prisma.stage.findMany({ where: { projectId: { in: pids } } }),
    prisma.activity.findMany({ where: { stage: { projectId: { in: pids } } } }),
    prisma.task.findMany({ where: { OR: [{ projectId: { in: pids } }, ...(only ? [] : [{ projectId: null, ownerId: userId }])] } }),
    prisma.deliverable.findMany({ where: { projectId: { in: pids } } }),
    prisma.document.findMany({ where: { projectId: { in: pids } } }),
    prisma.folder.findMany({ where: { projectId: { in: pids } } }),
  ]);
  const taskIds = tasks.map((t) => t.id);
  const [contributors, sessions, comments] = await Promise.all([
    prisma.taskContributor.findMany({ where: { taskId: { in: taskIds } } }),
    prisma.workSession.findMany({ where: { taskId: { in: taskIds } } }),
    commentRows({ taskId: { in: taskIds } }),
  ]);

  const groups: Array<[SyncEntity, Row[]]> = [
    ["MindMap", maps],
    ["MindMapShare", shares],
    ["MindNode", nodes],
    ["Project", projects],
    ["ProjectMember", members],
    ["Stage", stages],
    ["Activity", activities],
    ["Task", tasks],
    ["TaskContributor", contributors],
    ["WorkSession", sessions],
    ["TaskComment", comments],
    ["MindNodeTask", links],
    ["Deliverable", deliverables],
    ["Document", documents],
    ["Folder", folders],
  ];
  const allIds = groups.flatMap(([e, rows]) => rows.map((r) => compositeId(e, r)));
  const seqs = await fieldSeqs(allIds);
  const changes: SyncChange[] = groups.flatMap(([entity, rows]) =>
    rows.map((r) => {
      const id = compositeId(entity, r);
      return { entity, id, op: "upsert" as const, data: serialize(entity, r), seqs: seqs.get(`${entity}|${id}`) ?? {} };
    }),
  );
  return { protocol: SYNC_PROTOCOL_VERSION, cursor, hasMore: false, snapshot: true, scope, changes };
}

/** Changements depuis `cursor` dans le périmètre de l'utilisateur, par pages. */
export async function pull(userId: string, cursor: number, limit = 1000): Promise<PullResult> {
  const scope = await scopeOf(userId);
  const logs = await prisma.$queryRaw<Array<{ seq: bigint; entity: SyncEntity; entityId: string; op: "UPSERT" | "DELETE" }>>`
    SELECT "seq", "entity", "entityId", "op" FROM "SyncLog"
    WHERE "seq" > ${BigInt(cursor)}
      AND ("projectId" = ANY(${scope.projectIds}::text[]) OR "mapId" = ANY(${scope.mapIds}::text[]) OR ("ownerId" = ${userId} AND "projectId" IS NULL))
    ORDER BY "seq" ASC
    LIMIT ${limit + 1}`;
  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = page.length ? Number(page[page.length - 1].seq) : cursor;

  // Dernière opération par objet.
  const last = new Map<string, { entity: SyncEntity; id: string; op: "UPSERT" | "DELETE" }>();
  for (const l of page) last.set(`${l.entity}|${l.entityId}`, { entity: l.entity, id: l.entityId, op: l.op });

  const byEntity = new Map<SyncEntity, string[]>();
  for (const v of last.values()) if (v.op === "UPSERT") byEntity.set(v.entity, [...(byEntity.get(v.entity) ?? []), v.id]);
  const rows = new Map<string, Row>();
  for (const [entity, ids] of byEntity) {
    const visible = await visibleRows(userId, scope, entity, await fetchRows(entity, ids));
    for (const [id, r] of visible) rows.set(`${entity}|${id}`, r);
  }
  const seqs = await fieldSeqs([...rows.keys()].map((k) => k.split("|")[1]));

  const changes: SyncChange[] = [];
  for (const [key, v] of last) {
    const r = rows.get(key);
    // Supprimé, sorti du périmètre, ou disparu depuis : suppression côté client.
    if (v.op === "DELETE" || !r) changes.push({ entity: v.entity, id: v.id, op: "delete" });
    else changes.push({ entity: v.entity, id: v.id, op: "upsert", data: serialize(v.entity, r), seqs: seqs.get(key) ?? {} });
  }
  return { protocol: SYNC_PROTOCOL_VERSION, cursor: nextCursor, hasMore, snapshot: false, scope, changes };
}

// --- Push ------------------------------------------------------------------------------

export type OpResult = {
  opId: string;
  /** applied : tout est appliqué ; conflict : des champs (ou la suppression) ont été refusés ; rejected : opération invalide ou interdite. */
  status: "applied" | "conflict" | "rejected";
  /** Champs refusés car modifiés sur le serveur depuis la version connue, avec la valeur retenue. */
  conflicts?: Array<{ field: string; serverValue: unknown }>;
  /** L'objet n'existe plus (ou plus pour vous) sur le serveur. */
  deleted?: boolean;
  error?: { code: string; message: string };
  /** État serveur de l'objet après l'opération (valeurs dérivées comprises) et versions de ses champs. */
  data?: Row;
  seqs?: FieldSeqs;
};

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const notesSchema = z.string().max(500_000);

/** Ligne visible par l'utilisateur, avec ses versions de champs ; null si absente ou invisible. */
async function loadVisible(userId: string, entity: SyncEntity, id: string): Promise<{ row: Row; seqs: FieldSeqs } | null> {
  const scope = await scopeOf(userId);
  const rows = await visibleRows(userId, scope, entity, await fetchRows(entity, [id]));
  const row = rows.get(id);
  if (!row) return null;
  const seqs = (await fieldSeqs([id])).get(`${entity}|${id}`) ?? {};
  return { row, seqs };
}

/** Sépare les champs applicables de ceux modifiés sur le serveur depuis la version connue. */
function splitConflicts(fields: Row, base: Record<string, number>, current: { row: Row; seqs: FieldSeqs }) {
  const apply: Row = {};
  const conflicts: Array<{ field: string; serverValue: unknown }> = [];
  for (const [f, v] of Object.entries(fields)) {
    const known = base[f] ?? base["*"] ?? 0;
    if (seqOf(current.seqs, f) > known) {
      const sv = current.row[f];
      conflicts.push({ field: f, serverValue: sv instanceof Date ? sv.toISOString() : sv });
    } else apply[f] = v;
  }
  return { apply, conflicts };
}

const take = (obj: Row, keys: string[]) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
const drop = (obj: Row, keys: string[]) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const NOTE_KIND: Partial<Record<SyncEntity, string>> = { Project: "project", Stage: "stage", Activity: "activity", Task: "task" };

async function applyCreate(userId: string, op: SyncOpInput): Promise<void> {
  const f = (op.fields ?? {}) as Row;
  const [a, b] = op.id.split(":");
  switch (op.entity) {
    case "MindMap": {
      const { title } = createMindMapSchema.parse(f);
      const rootId = typeof f.rootId === "string" && ID_RE.test(f.rootId) ? f.rootId : undefined;
      await createMindMap(userId, title, { id: op.id, rootId });
      return;
    }
    case "MindNode": {
      const mapId = String(f.mapId ?? "");
      const input = createNodeSchema.parse({ parentId: f.parentId, title: f.title ?? undefined, index: typeof f.order === "number" ? f.order : undefined });
      await createNode(userId, mapId, input, op.id);
      const rest = updateNodeSchema.parse(drop(f, ["mapId", "parentId", "title", "order"]));
      if (Object.keys(rest).length) await updateNode(userId, mapId, op.id, rest);
      return;
    }
    case "Project":
      {
        // Membre « moi » créé hors ligne : même identifiant côté serveur (tâches déjà affectées).
        const mid = typeof f.ownerMemberId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(f.ownerMemberId) ? f.ownerMemberId : undefined;
        await createProject(userId, createProjectSchema.parse(drop(f, ["notes", "ownerMemberId"])), op.id, mid);
      }
      if (typeof f.notes === "string") await saveNotes(userId, `project:${op.id}`, notesSchema.parse(f.notes));
      return;
    case "Stage":
      await createStage(userId, String(f.projectId ?? ""), createStageSchema.parse(drop(f, ["projectId", "notes"])), op.id);
      if (typeof f.notes === "string") await saveNotes(userId, `stage:${op.id}`, notesSchema.parse(f.notes));
      return;
    case "Activity":
      await createActivity(userId, String(f.stageId ?? ""), createActivitySchema.parse(drop(f, ["stageId", "notes"])), op.id);
      if (typeof f.notes === "string") await saveNotes(userId, `activity:${op.id}`, notesSchema.parse(f.notes));
      return;
    case "Task": {
      const target = { projectId: (f.projectId as string | null) ?? null, stageId: (f.stageId as string | null) ?? null, activityId: (f.activityId as string | null) ?? null, nodeId: (f.nodeId as string | null) ?? null };
      await createTask(userId, target, createTaskSchema.parse(drop(f, ["projectId", "stageId", "activityId", "nodeId", "notes", "closedAt"])), op.id);
      if (typeof f.notes === "string") await saveNotes(userId, `task:${op.id}`, notesSchema.parse(f.notes));
      return;
    }
    case "TaskComment":
      await addComment(userId, String(f.taskId ?? ""), z.string().trim().min(1).max(10_000).parse(f.body), (f.parentId as string | null) ?? null, op.id);
      return;
    case "WorkSession":
      await addWorkSession(userId, String(f.taskId ?? ""), z.string().regex(/^\d{4}-\d{2}-\d{2}/).parse(f.date).slice(0, 10), op.id);
      return;
    case "MindNodeTask":
      await linkNodeTask(userId, a, b);
      return;
    case "TaskContributor": {
      const t = await prisma.task.findUnique({ where: { id: a }, select: { contributors: { select: { memberId: true } } } });
      if (!t) throw notFound("Tâche");
      await updateTask(userId, a, { contributorIds: [...new Set([...t.contributors.map((c) => c.memberId), b])] });
      return;
    }
    default:
      throw badRequest("Création non prise en charge.");
  }
}

async function applyUpdate(userId: string, entity: SyncEntity, id: string, fields: Row, current: Row): Promise<void> {
  const notes = typeof fields.notes === "string" ? notesSchema.parse(fields.notes) : undefined;
  const rest = drop(fields, ["notes"]);
  switch (entity) {
    case "MindMap":
      await updateMindMap(userId, id, updateMindMapSchema.parse(take(rest, ["title", "icon"])));
      return;
    case "MindNode": {
      const mapId = String(current.mapId);
      if (typeof fields.parentId === "string" && fields.parentId !== current.parentId) {
        await moveNode(userId, mapId, id, { parentId: fields.parentId, index: typeof fields.order === "number" ? fields.order : undefined });
      }
      const data = updateNodeSchema.parse({ ...drop(fields, ["parentId", "order", "mapId"]) });
      if (Object.keys(data).length) await updateNode(userId, mapId, id, data);
      return;
    }
    case "Project":
      if (Object.keys(rest).length) await updateProject(userId, id, updateProjectSchema.parse(rest));
      break;
    case "Stage":
      if (Object.keys(rest).length) await updateStage(userId, id, updateStageSchema.parse(rest));
      break;
    case "Activity":
      if (Object.keys(rest).length) await updateActivity(userId, id, updateActivitySchema.parse(rest));
      break;
    case "Task":
      if (Object.keys(rest).length) await updateTask(userId, id, updateTaskSchema.parse(rest));
      break;
    default:
      throw badRequest("Modification non prise en charge pour cet objet.");
  }
  if (notes !== undefined) await saveNotes(userId, `${NOTE_KIND[entity]}:${id}`, notes);
}

async function applyDelete(userId: string, entity: SyncEntity, id: string, current: Row): Promise<void> {
  const [a, b] = id.split(":");
  switch (entity) {
    case "MindMap":
      return deleteMindMap(userId, id);
    case "MindNode":
      return deleteNode(userId, String(current.mapId), id);
    case "Project":
      return deleteProject(userId, id);
    case "Stage":
      await deleteStage(userId, id);
      return;
    case "Activity":
      await deleteActivity(userId, id);
      return;
    case "Task":
      await deleteTask(userId, id);
      return;
    case "TaskComment":
      await deleteComment(userId, id);
      return;
    case "WorkSession":
      await deleteWorkSession(userId, id);
      return;
    case "MindNodeTask":
      await unlinkNodeTask(userId, a, b);
      return;
    case "TaskContributor": {
      const t = await prisma.task.findUnique({ where: { id: a }, select: { contributors: { select: { memberId: true } } } });
      if (t) await updateTask(userId, a, { contributorIds: t.contributors.map((c) => c.memberId).filter((m) => m !== b) });
      return;
    }
    default:
      throw badRequest("Suppression non prise en charge.");
  }
}

/** Complète un résultat avec l'état serveur courant de l'objet (s'il est encore visible). */
async function withState(userId: string, entity: SyncEntity, id: string, result: OpResult): Promise<OpResult> {
  const now = await loadVisible(userId, entity, id);
  return now ? { ...result, data: serialize(entity, now.row), seqs: now.seqs } : result;
}

async function runOp(userId: string, op: SyncOpInput): Promise<OpResult> {
  const r = await runOpInner(userId, op);
  if (r.status === "rejected" || r.deleted || op.op === "delete") return r;
  return withState(userId, op.entity as SyncEntity, op.id, r);
}

async function runOpInner(userId: string, op: SyncOpInput): Promise<OpResult> {
  const base = op.base ?? {};
  const entity = op.entity as SyncEntity;
  if (op.op === "create") {
    const composite = entity === "MindNodeTask" || entity === "TaskContributor";
    if (composite ? op.id.split(":").length !== 2 : !ID_RE.test(op.id)) throw badRequest("Identifiant invalide.");
    const existing = await fetchRows(entity, [op.id]);
    if (existing.size) {
      // Déjà créé (renvoi après coupure) : idempotent si l'objet est à vous ; sinon refus.
      if (await loadVisible(userId, entity, op.id)) return { opId: op.opId, status: "applied" };
      throw new ApiError(409, "ID_TAKEN", "Identifiant déjà utilisé.");
    }
    await applyCreate(userId, op);
    return { opId: op.opId, status: "applied" };
  }

  const current = await loadVisible(userId, entity, op.id);
  if (op.op === "delete") {
    if (!current) return { opId: op.opId, status: "applied", deleted: true }; // déjà supprimé
    if (maxSeq(current.seqs) > (base["*"] ?? 0)) {
      // Modifié sur le serveur depuis : la suppression est refusée, l'objet revient.
      return { opId: op.opId, status: "conflict", conflicts: [{ field: "*", serverValue: null }] };
    }
    await applyDelete(userId, entity, op.id, current.row);
    return { opId: op.opId, status: "applied" };
  }

  // update
  if (!current) return { opId: op.opId, status: "conflict", deleted: true }; // supprimé sur le serveur : il l'emporte
  const { apply, conflicts } = splitConflicts((op.fields ?? {}) as Row, base, current);
  if (Object.keys(apply).length) await applyUpdate(userId, entity, op.id, apply, current.row);
  return conflicts.length ? { opId: op.opId, status: "conflict", conflicts } : { opId: op.opId, status: "applied" };
}

const APPLIED_OP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Rejoue des opérations dans l'ordre ; chaque opération n'est appliquée qu'une fois (idempotence). */
export async function push(userId: string, ops: SyncOpInput[]): Promise<{ protocol: number; results: OpResult[] }> {
  // Purge opportuniste (≈ 1 appel sur 100) des journaux d'idempotence de plus de 30 jours.
  if (Math.random() < 0.01) {
    void prisma.appliedOp
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - APPLIED_OP_RETENTION_MS) } } })
      .catch((e) => console.error("[sync] purge AppliedOp", e));
  }
  const results: OpResult[] = [];
  for (const op of ops) {
    const done = await prisma.appliedOp.findUnique({ where: { userId_opId: { userId, opId: op.opId } } });
    if (done) {
      results.push(done.result as unknown as OpResult);
      continue;
    }
    let result: OpResult;
    try {
      result = await runOp(userId, op);
    } catch (e) {
      if (e instanceof ApiError) result = { opId: op.opId, status: "rejected", error: { code: e.code, message: e.message } };
      else if (e instanceof z.ZodError) result = { opId: op.opId, status: "rejected", error: { code: "VALIDATION", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ") } };
      else throw e;
    }
    await prisma.appliedOp.create({ data: { userId, opId: op.opId, result: result as unknown as Prisma.InputJsonValue } });
    results.push(result);
  }
  return { protocol: SYNC_PROTOCOL_VERSION, results };
}
