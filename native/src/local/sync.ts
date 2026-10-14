import { NetworkError, isForcedOffline, remote, remoteUpload } from "./remote";
import type { Store } from "./store";
import { WRITABLE, type ConflictEntry, type Entity, type FieldSeqs, type Op, type OpKind, type Row, type RowRec, type SyncStatus } from "./types";

/**
 * Moteur de synchronisation de l'application native (docs/05-offline-sync.md).
 *
 *  - Chaque modification locale ajoute une opération à la file (outbox),
 *    avec la version de chaque champ telle que l'utilisateur l'a vue. Les
 *    opérations en attente sur un même objet sont **fusionnées** (création +
 *    modifications = une création ; création + suppression = rien).
 *  - `syncNow()` : envoie la file (push), traite les résultats (conflits →
 *    historique « Conflits », la valeur serveur l'emporte), puis récupère les
 *    changements (pull) et purge ce qui sort du périmètre.
 *  - Serveur incompatible (426) : `upgradeRequired`, on arrête et on demande
 *    une mise à jour. Jeton refusé (401) : `signedOut`.
 */

const SYNC_INTERVAL_MS = 30_000;
const AFTER_WRITE_DELAY_MS = 1_500;
const PUSH_BATCH = 100;

type Change = { entity: Entity; id: string; op: "upsert" | "delete"; data?: Row; seqs?: FieldSeqs };
type PullResult = { protocol: number; cursor: number | null; hasMore: boolean; snapshot: boolean; scope: { projectIds: string[]; mapIds: string[] }; changes: Change[] };
type OpResult = {
  opId: string;
  status: "applied" | "conflict" | "rejected";
  conflicts?: Array<{ field: string; serverValue: unknown }>;
  deleted?: boolean;
  error?: { code: string; message: string };
  data?: Row;
  seqs?: FieldSeqs;
};

export function newId(prefix = "c"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function seqOf(seqs: FieldSeqs | undefined, field: string): number {
  if (!seqs) return 0;
  return Math.max(seqs[field] ?? 0, seqs["*"] ?? 0);
}
const maxSeq = (seqs: FieldSeqs | undefined) => (seqs ? Math.max(0, ...Object.values(seqs)) : 0);

const DATA_IMG_RE = /src="(data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)"/g;

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const type = head.slice(5, head.indexOf(";"));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Libellé lisible d'un objet (messages de conflit). */
export function labelOf(entity: Entity, row: Row | undefined): string {
  if (!row) return entity;
  return String(row.name ?? row.title ?? row.body ?? row.date ?? entity).slice(0, 80);
}

export class SyncEngine {
  status: SyncStatus = { online: false, syncing: false, pending: 0, conflicts: 0, lastSyncAt: null, lastError: null, upgradeRequired: false, signedOut: false, remoteChanges: 0 };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** Opérations en cours d'envoi (non fusionnables). */
  private inflight = new Set<string>();

  constructor(private store: Store) {
    this.status.pending = store.outbox.length;
    this.status.conflicts = store.conflicts.length;
    this.status.lastSyncAt = store.meta.lastSyncAt;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(patch: Partial<SyncStatus> = {}) {
    this.status = { ...this.status, ...patch, pending: this.store.outbox.length, conflicts: this.store.conflicts.length };
    for (const l of this.listeners) l();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("focus", this.onOnline);
    }
    void this.syncNow();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("focus", this.onOnline);
    }
  }
  private onOnline = () => void this.syncNow();

  /** L'écran a pris en compte les changements arrivés du serveur. */
  ackRemoteChanges() {
    if (this.status.remoteChanges) this.emit({ remoteChanges: 0 });
  }

  // --- File d'opérations -----------------------------------------------------------

  /**
   * Ajoute une opération locale. `base` = versions vues par l'utilisateur au
   * moment de la modification (capturées maintenant, jamais à l'envoi).
   */
  enqueue(entity: Entity, id: string, op: OpKind, fields?: Row, label?: string) {
    if (!WRITABLE.has(entity)) throw new Error(`Entité en lecture seule : ${entity}`);
    const rec = this.store.rec(entity, id);
    const ops = [...this.store.outbox];
    const pending = ops.filter((o) => o.entity === entity && o.id === id && !this.inflight.has(o.opId));
    const pendingCreate = pending.find((o) => o.op === "create");
    const pendingUpdate = pending.find((o) => o.op === "update");
    const now = new Date().toISOString();

    if (op === "update") {
      if (pendingCreate) {
        pendingCreate.fields = { ...pendingCreate.fields, ...fields };
      } else if (pendingUpdate) {
        const base = { ...pendingUpdate.base };
        for (const f of Object.keys(fields ?? {})) if (!(f in base)) base[f] = seqOf(rec?.seqs, f);
        pendingUpdate.fields = { ...pendingUpdate.fields, ...fields };
        pendingUpdate.base = base;
      } else {
        const base: FieldSeqs = { "*": maxSeq(rec?.seqs) };
        for (const f of Object.keys(fields ?? {})) base[f] = seqOf(rec?.seqs, f);
        ops.push({ opId: newId("op"), entity, id, op, fields, base, label, createdAt: now });
      }
    } else if (op === "delete") {
      const without = ops.filter((o) => !(o.entity === entity && o.id === id && !this.inflight.has(o.opId)));
      if (pendingCreate) {
        // Créé puis supprimé hors ligne : le serveur n'en saura rien.
        this.store.setOutbox(without);
        this.emit();
        return;
      }
      without.push({ opId: newId("op"), entity, id, op, base: { "*": maxSeq(rec?.seqs) }, label, createdAt: now });
      this.store.setOutbox(without);
      this.emit();
      this.scheduleSoon();
      return;
    } else {
      ops.push({ opId: newId("op"), entity, id, op, fields, label, createdAt: now });
    }
    this.store.setOutbox(ops);
    this.emit();
    this.scheduleSoon();
  }

  /** Champs en attente d'envoi sur un objet (à préserver quand le serveur renvoie l'objet). */
  private pendingFields(entity: Entity, id: string): { fields: Row; deleted: boolean; created: boolean } {
    const fields: Row = {};
    let deleted = false;
    let created = false;
    for (const o of this.store.outbox) {
      if (o.entity !== entity || o.id !== id) continue;
      if (o.op === "delete") deleted = true;
      if (o.op === "create") created = true;
      Object.assign(fields, o.fields ?? {});
    }
    return { fields, deleted, created };
  }

  /** Applique une ligne serveur en conservant les modifications locales pas encore envoyées. */
  private applyServerRow(entity: Entity, id: string, data: Row, seqs: FieldSeqs = {}) {
    const p = this.pendingFields(entity, id);
    if (p.deleted) return;
    const merged = { ...data };
    for (const [f, v] of Object.entries(p.fields)) if (f in merged) merged[f] = v;
    if (entity === "ProjectMember") {
      // Un vrai membre arrive : retirer le membre provisoire créé hors ligne pour ce projet.
      for (const m of this.store.where("ProjectMember", (r) => r._provisional && r.projectId === data.projectId)) this.store.remove("ProjectMember", m.id);
    }
    this.store.put(entity, id, merged, seqs);
  }

  private scheduleSoon() {
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.syncNow(), AFTER_WRITE_DELAY_MS);
  }

  // --- Synchronisation -------------------------------------------------------------

  async syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (this.status.upgradeRequired || this.status.signedOut || !this.store.meta.token) return;
    this.running = (async () => {
      this.emit({ syncing: true });
      try {
        do {
          this.again = false;
          const resync = await this.push();
          await this.pull(resync);
        } while (this.again);
        const at = new Date().toISOString();
        this.store.setMeta("lastSyncAt", at);
        this.emit({ online: true, lastSyncAt: at, lastError: null });
      } catch (e) {
        if (e instanceof NetworkError) this.emit({ online: false, lastError: isForcedOffline() ? null : e.message });
        else this.emit({ lastError: e instanceof Error ? e.message : String(e) });
      } finally {
        this.inflight.clear();
        this.running = null;
        this.emit({ syncing: false });
        await this.store.flush();
      }
    })();
    return this.running;
  }

  /** Vérifie la réponse : 426 (mise à jour obligatoire), 401 (session expirée). */
  private guard(status: number, data: unknown) {
    if (status === 426) {
      this.emit({ upgradeRequired: true });
      throw new Error("Mise à jour de l'application nécessaire.");
    }
    if (status === 401) {
      this.emit({ signedOut: true });
      throw new Error("Session expirée : reconnectez-vous.");
    }
    if (status >= 400) {
      const msg = (data as { error?: { message?: string } })?.error?.message ?? `Erreur ${status}`;
      throw new Error(msg);
    }
  }

  /** Remplace les images collées hors ligne (data:) par des URL serveur, dans l'opération et la ligne locale. */
  private async uploadInlineImages(op: Op) {
    for (const [field, value] of Object.entries(op.fields ?? {})) {
      if (typeof value !== "string" || !value.includes("data:image/")) continue;
      let html = value;
      for (const m of [...value.matchAll(DATA_IMG_RE)]) {
        const url = await remoteUpload(dataUrlToBlob(m[1]), `image.${m[2] === "jpeg" ? "jpg" : m[2]}`);
        html = html.split(m[1]).join(url);
      }
      op.fields![field] = html;
      const local = this.store.get(op.entity, op.id);
      if (local && typeof local[field] === "string") this.store.patch(op.entity, op.id, { [field]: html });
    }
  }

  /** Envoie la file. Renvoie vrai si un instantané complet est nécessaire (refus, objet à restaurer). */
  private async push(): Promise<boolean> {
    let resync = false;
    while (this.store.outbox.length) {
      const batch = this.store.outbox.slice(0, PUSH_BATCH);
      for (const op of batch) this.inflight.add(op.opId);
      for (const op of batch) await this.uploadInlineImages(op);
      const r = await remote<{ results: OpResult[] }>("POST", "/sync/push", { ops: batch.map(({ opId, entity, id, op, fields, base }) => ({ opId, entity, id, op, fields, base })) });
      this.guard(r.status, r.data);
      for (let i = 0; i < batch.length; i++) {
        const op = batch[i];
        const res = r.data.results[i];
        // Retirer l'opération envoyée avant d'appliquer l'état serveur (sinon elle masquerait celui-ci).
        this.store.setOutbox(this.store.outbox.filter((o) => o.opId !== op.opId));
        if (this.handleResult(op, res)) resync = true;
      }
      for (const op of batch) this.inflight.delete(op.opId);
      this.emit();
    }
    return resync;
  }

  private conflict(c: Omit<ConflictEntry, "id" | "at">) {
    this.store.addConflict({ ...c, id: newId("cf"), at: new Date().toISOString() });
  }

  /** Les opérations suivantes sur le même objet partaient de versions antérieures à la nôtre : on les met à niveau. */
  private bumpLaterBases(op: Op, seqs: FieldSeqs | undefined, allFields: boolean) {
    if (!seqs) return;
    const fields = Object.keys(op.fields ?? {});
    const ops = this.store.outbox.map((o) => {
      if (o.entity !== op.entity || o.id !== op.id || !o.base) return o;
      const base = { ...o.base };
      for (const f of Object.keys(base)) {
        if (f === "*" || allFields || fields.includes(f)) base[f] = Math.max(base[f], f === "*" ? maxSeq(seqs) : seqOf(seqs, f));
      }
      return { ...o, base };
    });
    this.store.setOutbox(ops);
  }

  private dropLaterOps(op: Op) {
    this.store.setOutbox(this.store.outbox.filter((o) => !(o.entity === op.entity && o.id === op.id)));
  }

  /** Traite le résultat d'une opération ; renvoie vrai si un instantané complet est nécessaire. */
  private handleResult(op: Op, res: OpResult | undefined): boolean {
    const label = op.label ?? labelOf(op.entity, this.store.get(op.entity, op.id));
    if (!res) return true;
    if (res.status === "rejected") {
      this.conflict({ entity: op.entity, entityId: op.id, label, field: "*", kind: "rejected", localValue: op.fields ?? null, serverValue: null, message: res.error?.message });
      if (op.op === "create") this.store.removeCascade(op.entity, op.id);
      this.dropLaterOps(op);
      return true;
    }
    if (res.deleted && op.op !== "delete") {
      this.conflict({ entity: op.entity, entityId: op.id, label, field: "*", kind: "deleted-on-server", localValue: op.fields ?? null, serverValue: null, message: "Supprimé sur le serveur : vos modifications n'ont pas été appliquées." });
      this.store.removeCascade(op.entity, op.id);
      this.dropLaterOps(op);
      return false;
    }
    if (op.op === "delete") {
      if (res.status === "conflict") {
        this.conflict({ entity: op.entity, entityId: op.id, label, field: "*", kind: "delete-refused", localValue: null, serverValue: null, message: "Modifié sur le serveur entre-temps : la suppression a été annulée et l'élément restauré." });
        return true;
      }
      return false;
    }
    for (const c of res.conflicts ?? []) {
      this.conflict({ entity: op.entity, entityId: op.id, label, field: c.field, kind: "overwritten", localValue: op.fields?.[c.field] ?? null, serverValue: c.serverValue, message: "Les valeurs les plus récentes proviennent du serveur : votre modification a été écrasée." });
    }
    if (res.data) this.applyServerRow(op.entity, op.id, res.data, res.seqs);
    this.bumpLaterBases(op, res.seqs, op.op === "create");
    return false;
  }

  private async pull(full: boolean) {
    if (full || !this.store.meta.cursor) {
      const r = await remote<PullResult>("GET", "/sync/pull");
      this.guard(r.status, r.data);
      this.applySnapshot(r.data);
      return;
    }
    let page: PullResult;
    let changed = 0;
    do {
      const r = await remote<PullResult>("GET", `/sync/pull?cursor=${this.store.meta.cursor}`);
      this.guard(r.status, r.data);
      page = r.data;
      for (const c of page.changes) {
        if (c.op === "delete") this.store.removeCascade(c.entity, c.id);
        else this.applyServerRow(c.entity, c.id, c.data ?? {}, c.seqs);
      }
      changed += page.changes.length;
      if (page.cursor !== null) this.store.setMeta("cursor", page.cursor);
    } while (page.hasMore);
    changed += await this.reconcileScope(page.scope);
    if (changed) this.emit({ remoteChanges: this.status.remoteChanges + changed });
  }

  /** Instantané complet : remplace les données locales, en gardant les créations et modifications non envoyées. */
  private applySnapshot(p: PullResult) {
    const recs: Array<{ entity: Entity; id: string; rec: RowRec }> = [];
    const seen = new Set<string>();
    for (const c of p.changes) {
      if (c.op !== "upsert") continue;
      const pend = this.pendingFields(c.entity, c.id);
      if (pend.deleted) continue;
      const data = { ...(c.data ?? {}) };
      for (const [f, v] of Object.entries(pend.fields)) if (f in data) data[f] = v;
      recs.push({ entity: c.entity, id: c.id, rec: { data, seqs: c.seqs ?? {} } });
      seen.add(`${c.entity}|${c.id}`);
    }
    // Créations locales pas encore connues du serveur.
    for (const o of this.store.outbox) {
      if (o.op !== "create" || seen.has(`${o.entity}|${o.id}`)) continue;
      const rec = this.store.rec(o.entity, o.id);
      if (rec) recs.push({ entity: o.entity, id: o.id, rec });
    }
    this.store.replaceAll(recs);
    if (p.cursor !== null) this.store.setMeta("cursor", p.cursor);
    this.emit({ remoteChanges: this.status.remoteChanges + 1 });
  }

  /** Purge ce qui sort du périmètre ; charge ce qui y entre. Renvoie le nombre de changements. */
  private async reconcileScope(scope: PullResult["scope"]): Promise<number> {
    let changed = 0;
    const pids = new Set(scope.projectIds);
    const mids = new Set(scope.mapIds);
    for (const p of this.store.all("Project")) {
      if (!pids.has(p.id) && !this.pendingFields("Project", p.id).created) {
        this.store.removeCascade("Project", p.id);
        changed++;
      }
    }
    for (const m of this.store.all("MindMap")) {
      if (!mids.has(m.id) && !this.pendingFields("MindMap", m.id).created) {
        this.store.removeCascade("MindMap", m.id);
        changed++;
      }
    }
    const missing = [...scope.projectIds.filter((id) => !this.store.get("Project", id)).map((id) => `project=${id}`), ...scope.mapIds.filter((id) => !this.store.get("MindMap", id)).map((id) => `map=${id}`)];
    for (const q of missing) {
      const r = await remote<PullResult>("GET", `/sync/pull?${q}`);
      if (r.status === 404) continue;
      this.guard(r.status, r.data);
      for (const c of r.data.changes) if (c.op === "upsert") this.applyServerRow(c.entity, c.id, c.data ?? {}, c.seqs);
      changed += r.data.changes.length;
    }
    return changed;
  }
}
