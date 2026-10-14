import type { ConflictEntry, Meta, Op, RowRec } from "./types";

/**
 * Persistance IndexedDB de l'application native. Le contenu est chargé une
 * fois en mémoire au démarrage (store.ts) puis écrit au fil de l'eau.
 * IndexedDB est durable dans Electron (profil applicatif) et dans une
 * WebView d'application iOS.
 *
 * Magasins : rows (clé « Entité|id »), outbox (opérations en attente, dans
 * l'ordre), conflicts (historique « Conflits »), meta (curseur, session…).
 */

const DB_NAME = "secondbrain";
const DB_VERSION = 1;

export type Persisted = { rows: Array<{ key: string } & RowRec>; outbox: Op[]; conflicts: ConflictEntry[]; meta: Partial<Meta> };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class LocalDb {
  private db: IDBDatabase | null = null;
  constructor(private factory: IDBFactory = indexedDB, private name = DB_NAME) {}

  async open(): Promise<void> {
    if (this.db) return;
    const r = this.factory.open(this.name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("rows")) db.createObjectStore("rows", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    this.db = await req(r);
  }

  private get handle(): IDBDatabase {
    if (!this.db) throw new Error("Base locale non ouverte");
    return this.db;
  }

  async loadAll(): Promise<Persisted> {
    const tx = this.handle.transaction(["rows", "outbox", "conflicts", "meta"], "readonly");
    const [rows, outbox, conflicts, metaKeys, metaValues] = await Promise.all([
      req(tx.objectStore("rows").getAll()),
      req(tx.objectStore("outbox").getAll()),
      req(tx.objectStore("conflicts").getAll()),
      req(tx.objectStore("meta").getAllKeys()),
      req(tx.objectStore("meta").getAll()),
    ]);
    const meta: Partial<Meta> = {};
    metaKeys.forEach((k, i) => ((meta as Record<string, unknown>)[String(k)] = metaValues[i]));
    return {
      rows: rows as Persisted["rows"],
      outbox: (outbox as Array<Op & { seq: number }>).sort((a, b) => a.seq - b.seq).map(({ seq, ...op }) => (void seq, op as Op)),
      conflicts: conflicts as ConflictEntry[],
      meta,
    };
  }

  /** Écrit un lot de changements en une transaction. */
  async write(batch: {
    putRows?: Array<{ key: string } & RowRec>;
    deleteRows?: string[];
    outbox?: Op[] | null;
    putConflicts?: ConflictEntry[];
    deleteConflicts?: string[];
    meta?: Partial<Meta>;
    clearRows?: boolean;
  }): Promise<void> {
    const tx = this.handle.transaction(["rows", "outbox", "conflicts", "meta"], "readwrite");
    const rows = tx.objectStore("rows");
    if (batch.clearRows) rows.clear();
    for (const r of batch.putRows ?? []) rows.put(r);
    for (const k of batch.deleteRows ?? []) rows.delete(k);
    if (batch.outbox) {
      // La file est réécrite en entier (quelques dizaines d'éléments au plus) : l'ordre est conservé.
      const ob = tx.objectStore("outbox");
      ob.clear();
      for (const op of batch.outbox) ob.add({ ...op });
    }
    const cf = tx.objectStore("conflicts");
    for (const c of batch.putConflicts ?? []) cf.put(c);
    for (const id of batch.deleteConflicts ?? []) cf.delete(id);
    const meta = tx.objectStore("meta");
    for (const [k, v] of Object.entries(batch.meta ?? {})) meta.put(v, k);
    await done(tx);
  }

  async clear(): Promise<void> {
    const tx = this.handle.transaction(["rows", "outbox", "conflicts", "meta"], "readwrite");
    for (const s of ["rows", "outbox", "conflicts", "meta"]) tx.objectStore(s).clear();
    await done(tx);
  }
}
