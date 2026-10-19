import { LocalDb } from "./db";
import { ENTITIES, type ConflictEntry, type Entity, type FieldSeqs, type Meta, type Op, type Row, type RowRec } from "./types";

/**
 * Magasin local en mémoire, persisté dans IndexedDB : tables par entité
 * (lignes + versions de champs), file d'opérations en attente, historique des
 * conflits, métadonnées. Les écritures en base sont regroupées et différées
 * (une transaction par tour d'événements).
 */

const DEFAULT_META: Meta = { serverUrl: "", token: null, user: null, cursor: 0, protocol: 0, lastSyncAt: null, ranks: [], pendingRanks: null, dataVersion: 0, pins: null, customFields: null, projectTypes: null };

export class Store {
  tables = new Map<Entity, Map<string, RowRec>>(ENTITIES.map((e) => [e, new Map()]));
  outbox: Op[] = [];
  conflicts: ConflictEntry[] = [];
  meta: Meta = { ...DEFAULT_META };

  private dirtyRows = new Set<string>();
  private dirtyOutbox = false;
  private dirtyConflicts = new Set<string>();
  private deletedConflicts = new Set<string>();
  private dirtyMeta = new Set<keyof Meta>();
  private flushing: Promise<void> | null = null;
  private scheduled = false;
  private listeners = new Set<() => void>();

  constructor(private db: LocalDb) {}

  async load(): Promise<void> {
    await this.db.open();
    const p = await this.db.loadAll();
    for (const t of this.tables.values()) t.clear();
    for (const r of p.rows) {
      const [entity, ...rest] = r.key.split("|");
      this.tables.get(entity as Entity)?.set(rest.join("|"), { data: r.data, seqs: r.seqs });
    }
    this.outbox = p.outbox;
    this.conflicts = p.conflicts.sort((a, b) => b.at.localeCompare(a.at));
    this.meta = { ...DEFAULT_META, ...p.meta };
  }

  // --- Abonnements (statut, écrans) ----------------------------------------------
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  notify() {
    for (const l of this.listeners) l();
  }

  // --- Lecture -------------------------------------------------------------------
  table(entity: Entity): Map<string, RowRec> {
    return this.tables.get(entity)!;
  }
  get(entity: Entity, id: string): Row | undefined {
    return this.table(entity).get(id)?.data;
  }
  rec(entity: Entity, id: string): RowRec | undefined {
    return this.table(entity).get(id);
  }
  all(entity: Entity): Row[] {
    return [...this.table(entity).values()].map((r) => r.data);
  }
  where(entity: Entity, pred: (r: Row) => boolean): Row[] {
    const out: Row[] = [];
    for (const r of this.table(entity).values()) if (pred(r.data)) out.push(r.data);
    return out;
  }

  // --- Écriture ------------------------------------------------------------------
  put(entity: Entity, id: string, data: Row, seqs?: FieldSeqs) {
    const prev = this.table(entity).get(id);
    this.table(entity).set(id, { data, seqs: seqs ?? prev?.seqs ?? {} });
    this.dirtyRows.add(`${entity}|${id}`);
    this.schedule();
  }
  patch(entity: Entity, id: string, fields: Row) {
    const prev = this.table(entity).get(id);
    if (!prev) return;
    this.put(entity, id, { ...prev.data, ...fields, updatedAt: new Date().toISOString() }, prev.seqs);
  }
  remove(entity: Entity, id: string) {
    if (!this.table(entity).delete(id)) return;
    this.dirtyRows.add(`${entity}|${id}`);
    this.schedule();
  }

  /** Suppression en cascade, comme les clés étrangères du serveur. */
  removeCascade(entity: Entity, id: string) {
    switch (entity) {
      case "Project": {
        for (const s of this.where("Stage", (r) => r.projectId === id)) this.removeCascade("Stage", s.id);
        for (const t of this.where("Task", (r) => r.projectId === id)) this.removeCascade("Task", t.id);
        for (const e of ["ProjectMember", "Deliverable", "Document", "Folder"] as const) for (const r of this.where(e, (x) => x.projectId === id)) this.remove(e, r.id);
        break;
      }
      case "Stage":
        for (const a of this.where("Activity", (r) => r.stageId === id)) this.removeCascade("Activity", a.id);
        for (const t of this.where("Task", (r) => r.stageId === id)) this.removeCascade("Task", t.id);
        break;
      case "Activity":
        for (const t of this.where("Task", (r) => r.activityId === id)) this.removeCascade("Task", t.id);
        break;
      case "Task":
        for (const e of ["TaskContributor", "WorkSession", "TaskComment", "MindNodeTask"] as const) {
          for (const [key, r] of this.table(e)) if (r.data.taskId === id) this.remove(e, key);
        }
        break;
      case "MindMap":
        for (const n of this.where("MindNode", (r) => r.mapId === id)) this.removeCascade("MindNode", n.id);
        for (const [key, r] of this.table("MindMapShare")) if (r.data.mapId === id) this.remove("MindMapShare", key);
        break;
      case "MindNode": {
        for (const c of this.where("MindNode", (r) => r.parentId === id)) this.removeCascade("MindNode", c.id);
        for (const [key, r] of this.table("MindNodeTask")) if (r.data.nodeId === id) this.remove("MindNodeTask", key);
        break;
      }
      case "TaskComment":
        for (const c of this.where("TaskComment", (r) => r.parentId === id)) this.removeCascade("TaskComment", c.id);
        break;
    }
    this.remove(entity, id);
  }

  setOutbox(ops: Op[]) {
    this.outbox = ops;
    this.dirtyOutbox = true;
    this.schedule();
  }

  addConflict(c: ConflictEntry) {
    this.conflicts = [c, ...this.conflicts];
    this.dirtyConflicts.add(c.id);
    this.schedule();
    this.notify();
  }
  removeConflict(id: string) {
    this.conflicts = this.conflicts.filter((c) => c.id !== id);
    this.deletedConflicts.add(id);
    this.schedule();
    this.notify();
  }

  setMeta<K extends keyof Meta>(key: K, value: Meta[K]) {
    this.meta[key] = value;
    this.dirtyMeta.add(key);
    this.schedule();
  }

  /** Remplace toutes les lignes (instantané complet). */
  replaceAll(changes: Array<{ entity: Entity; id: string; rec: RowRec }>) {
    for (const t of this.tables.values()) t.clear();
    for (const c of changes) this.table(c.entity).set(c.id, c.rec);
    this.clearAllRows = true;
    for (const c of changes) this.dirtyRows.add(`${c.entity}|${c.id}`);
    this.schedule();
  }
  private clearAllRows = false;

  async wipe(): Promise<void> {
    await this.flush();
    for (const t of this.tables.values()) t.clear();
    this.outbox = [];
    this.conflicts = [];
    this.meta = { ...DEFAULT_META };
    await this.db.clear();
    this.notify();
  }

  // --- Persistance ---------------------------------------------------------------
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (!this.dirtyRows.size && !this.dirtyOutbox && !this.dirtyConflicts.size && !this.deletedConflicts.size && !this.dirtyMeta.size && !this.clearAllRows) return;
    const putRows: Array<{ key: string } & RowRec> = [];
    const deleteRows: string[] = [];
    for (const key of this.dirtyRows) {
      const [entity, ...rest] = key.split("|");
      const rec = this.tables.get(entity as Entity)?.get(rest.join("|"));
      if (rec) putRows.push({ key, data: rec.data, seqs: rec.seqs });
      else deleteRows.push(key);
    }
    const batch = {
      clearRows: this.clearAllRows,
      putRows,
      deleteRows,
      outbox: this.dirtyOutbox ? this.outbox : null,
      putConflicts: this.conflicts.filter((c) => this.dirtyConflicts.has(c.id)),
      deleteConflicts: [...this.deletedConflicts],
      meta: Object.fromEntries([...this.dirtyMeta].map((k) => [k, this.meta[k]])) as Partial<Meta>,
    };
    this.dirtyRows.clear();
    this.dirtyOutbox = false;
    this.dirtyConflicts.clear();
    this.deletedConflicts.clear();
    this.dirtyMeta.clear();
    this.clearAllRows = false;
    this.flushing = this.db.write(batch).finally(() => (this.flushing = null));
    await this.flushing;
  }
}
