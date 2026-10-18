/**
 * Voyage dans le temps : reconstitution de l'état d'une tâche ou d'une carte
 * à une date passée, en « rembobinant » les pistes d'audit (TaskEvent,
 * MapEvent) depuis l'état actuel. Règles pures, partagées et testées
 * (`npm run test:knowledge`).
 *
 * Les pistes figent des libellés lisibles (« En cours », « 40 % »,
 * « 15/10/2026 », noms des personnes) : on les retraduit ici. Limites : un
 * objet supprimé emporte son historique (tâches) ou n'est connu que par son
 * titre (nœuds) ; un déplacement de nœud n'est pas défait (signalé).
 */

export type TaskState = {
  name: string;
  status: string;
  progress: number;
  priority: string;
  complexity: string;
  startDate: string | null;
  dueDate: string | null;
  /** Nom du responsable (libellé de la piste d'audit). */
  assignee: string | null;
};

export type TaskEventLite = { createdAt: Date; kind: string; field: string | null; oldValue: string | null; newValue: string | null };

const STATUS: Record<string, string> = { "À faire": "TODO", "En cours": "IN_PROGRESS", Terminée: "DONE", Clôturée: "CLOSED" };
const PRIORITY: Record<string, string> = { Basse: "LOW", Moyenne: "MEDIUM", Haute: "HIGH", Critique: "CRITICAL" };
const COMPLEXITY: Record<string, string> = { Basse: "LOW", Moyenne: "MEDIUM", Forte: "HIGH" };

/** « 15/10/2026 » → « 2026-10-15 » ; null / « aucune » → null. */
export function parseFrDate(v: string | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const parsePercent = (v: string | null) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

/** État d'une tâche à la date `at` (la tâche existait déjà à cette date). */
export function rewindTask(current: TaskState, events: TaskEventLite[], at: Date): TaskState {
  const s: TaskState = { ...current };
  const after = events.filter((e) => e.createdAt.getTime() > at.getTime()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let progressRestored = false;
  for (const e of after) {
    switch (e.field) {
      case "name":
        if (e.oldValue !== null) s.name = e.oldValue;
        break;
      case "status":
        if (e.oldValue && STATUS[e.oldValue]) s.status = STATUS[e.oldValue];
        break;
      case "progress": {
        const p = parsePercent(e.oldValue);
        if (p !== null) {
          s.progress = p;
          progressRestored = true;
        }
        break;
      }
      case "priority":
        if (e.oldValue && PRIORITY[e.oldValue]) s.priority = PRIORITY[e.oldValue];
        break;
      case "complexity":
        if (e.oldValue && COMPLEXITY[e.oldValue]) s.complexity = COMPLEXITY[e.oldValue];
        break;
      case "startDate":
        s.startDate = parseFrDate(e.oldValue);
        break;
      case "dueDate":
        s.dueDate = parseFrDate(e.oldValue);
        break;
      case "assigneeId":
        s.assignee = e.oldValue || null;
        break;
    }
  }
  // Avancement cohérent avec le statut reconstitué (règle `reconcile`).
  if (s.status === "TODO") s.progress = 0;
  else if (s.status === "DONE" || s.status === "CLOSED") s.progress = 100;
  else if (!progressRestored && after.length) {
    // En cours : dernier avancement connu à cette date, sinon l'avancement actuel borné.
    const before = events
      .filter((e) => e.field === "progress" && e.createdAt.getTime() <= at.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const p = parsePercent(before?.newValue ?? null);
    s.progress = p ?? Math.max(1, Math.min(99, current.status === "IN_PROGRESS" ? current.progress : 50));
  }
  return s;
}

export type MapNodeLite = { id: string; parentId: string | null; title: string; status: string; color: string | null; createdAt: Date };
export type MapEventLite = { createdAt: Date; kind: string; nodeId: string | null; nodeTitle: string | null; oldValue: string | null; newValue: string | null };

export type RewoundMap = {
  nodes: MapNodeLite[];
  /** Nœuds qui existaient à cette date et ont été supprimés depuis (titre seul). */
  deletedSince: { id: string; title: string; at: string }[];
  /** Nœuds déplacés depuis (position actuelle conservée). */
  movedSince: { id: string; title: string; from: string | null }[];
};

/** État d'une carte à la date `at`. */
export function rewindMap(current: MapNodeLite[], events: MapEventLite[], at: Date): RewoundMap {
  const t = at.getTime();
  const nodes = current.filter((n) => n.createdAt.getTime() <= t).map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => n.parentId === null);
  const after = events.filter((e) => e.createdAt.getTime() > t).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const createdAfter = new Set(after.filter((e) => e.kind === "node_created" && e.nodeId).map((e) => e.nodeId!));
  const deletedSince: RewoundMap["deletedSince"] = [];
  const moved = new Map<string, RewoundMap["movedSince"][number]>();
  for (const e of after) {
    const n = e.nodeId ? byId.get(e.nodeId) : undefined;
    switch (e.kind) {
      case "renamed":
        if (root && e.oldValue !== null) root.title = e.oldValue;
        break;
      case "node_renamed":
        if (n && e.oldValue !== null) n.title = e.oldValue;
        break;
      case "node_status":
        if (n && e.oldValue && ["OPEN", "WATCH", "CLOSED"].includes(e.oldValue)) n.status = e.oldValue;
        break;
      case "node_color":
        if (n) n.color = e.oldValue;
        break;
      case "node_moved":
        if (n) moved.set(n.id, { id: n.id, title: n.title, from: e.oldValue });
        break;
      case "node_deleted":
        if (e.nodeId && !createdAfter.has(e.nodeId) && !byId.has(e.nodeId)) deletedSince.push({ id: e.nodeId, title: e.nodeTitle ?? e.oldValue ?? "sans titre", at: e.createdAt.toISOString() });
        break;
    }
  }
  // Un nœud dont un ancêtre n'existait pas encore est rattaché à la racine (cas d'un ancêtre recréé).
  for (const n of nodes) if (n.parentId && !byId.has(n.parentId) && root) n.parentId = root.id;
  return { nodes, deletedSince: deletedSince.reverse(), movedSince: [...moved.values()].map((m) => ({ ...m, title: byId.get(m.id)?.title ?? m.title })) };
}
