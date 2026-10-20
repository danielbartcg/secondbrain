/**
 * Tests de bout en bout de la synchronisation hors ligne (docs/05-offline-sync.md).
 *
 * Usage (serveur de dev lancé, inscriptions ouvertes) :
 *   npm run test:sync                       # http://localhost:3000
 *   BASE_URL=http://localhost:3001 npm run test:sync
 *
 * Crée deux comptes jetables (A propriétaire, B membre), simule deux
 * applications et vérifie : instantané, curseur, création hors ligne avec
 * identifiants client, idempotence des renvois, conflits par champ, suppression
 * contre modification, écritures web journalisées, périmètre, version de
 * protocole. Nettoie ses données à la fin.
 */
import { randomBytes } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/api/v1";
const PROTOCOL = "2";

let failures = 0;
let passes = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 800));
  }
}

const rid = (p = "c") => p + randomBytes(12).toString("hex"); // 25 caractères, comme un cuid
type Change = { entity: string; id: string; op: "upsert" | "delete"; data?: Record<string, unknown>; seqs?: Record<string, number> };
type Pull = { protocol: number; cursor: number | null; hasMore: boolean; snapshot: boolean; scope: { projectIds: string[]; mapIds: string[] }; changes: Change[] };
type OpResult = { opId: string; status: "applied" | "conflict" | "rejected"; conflicts?: Array<{ field: string; serverValue: unknown }>; deleted?: boolean; error?: { code: string; message: string }; data?: Record<string, unknown>; seqs?: Record<string, number> };

/** Une « application » : jeton Bearer, curseur et copie locale minimale (lignes + versions). */
class App {
  token = "";
  userId = "";
  cursor = 0;
  rows = new Map<string, { data: Record<string, unknown>; seqs: Record<string, number> }>();
  constructor(public label: string) {}

  async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  }

  async register(): Promise<void> {
    const email = `sync-${this.label.toLowerCase()}-${randomBytes(4).toString("hex")}@test.local`;
    const r = await this.call<{ user: { id: string }; token: string }>("POST", "/auth/register", { email, password: "Password123!", firstName: `Sync${this.label}`, lastName: "Test", client: "sync-e2e" });
    if (r.status !== 201) throw new Error(`Inscription impossible (${r.status}) : ${JSON.stringify(r.data)}`);
    this.token = r.data.token;
    this.userId = r.data.user.id;
  }

  apply(p: Pull) {
    for (const c of p.changes) {
      const key = `${c.entity}|${c.id}`;
      if (c.op === "delete") this.rows.delete(key);
      else this.rows.set(key, { data: c.data ?? {}, seqs: c.seqs ?? {} });
    }
    if (p.cursor !== null) this.cursor = p.cursor;
  }

  async sync(): Promise<Pull> {
    let last: Pull;
    do {
      const r = await this.call<Pull>("GET", this.cursor ? `/sync/pull?cursor=${this.cursor}` : "/sync/pull", undefined, { "X-Sync-Protocol": PROTOCOL });
      if (r.status !== 200) throw new Error(`pull ${r.status} ${JSON.stringify(r.data)}`);
      last = r.data;
      this.apply(last);
    } while (last.hasMore);
    return last;
  }

  get(entity: string, id: string) {
    return this.rows.get(`${entity}|${id}`);
  }

  /** Version connue d'un champ (comme le ferait le client). */
  base(entity: string, id: string, fields: string[]): Record<string, number> {
    const r = this.get(entity, id);
    const seqs = r?.seqs ?? {};
    const out: Record<string, number> = {};
    for (const f of fields) out[f] = Math.max(seqs[f] ?? 0, seqs["*"] ?? 0);
    out["*"] = Math.max(0, ...Object.values(seqs));
    return out;
  }

  async push(ops: Array<Record<string, unknown>>): Promise<OpResult[]> {
    const r = await this.call<{ results: OpResult[] }>("POST", "/sync/push", { ops }, { "X-Sync-Protocol": PROTOCOL });
    if (r.status !== 200) throw new Error(`push ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.results;
  }
}

async function main() {
  console.log(`Synchro hors ligne — ${BASE}`);
  const A = new App("A");
  const B = new App("B");
  await A.register();
  await B.register();

  console.log("\n1. Version de protocole");
  {
    const r = await A.call<{ error: { code: string } }>("GET", "/sync/pull", undefined, { "X-Sync-Protocol": "0" });
    check("version incompatible → 426 UPGRADE_REQUIRED", r.status === 426 && r.data.error.code === "UPGRADE_REQUIRED", r);
    const r2 = await A.call<unknown>("GET", "/sync/pull");
    check("en-tête absent → 426", r2.status === 426);
  }

  console.log("\n2. Création hors ligne avec identifiants client, puis renvoi");
  const projectId = rid();
  const stageId = rid();
  const taskId = rid();
  const mapId = rid();
  const rootId = rid();
  const nodeId = rid();
  const ops = [
    { opId: rid("op"), entity: "Project", id: projectId, op: "create", fields: { name: "Projet synchro", notes: "<p>Notes hors ligne</p>" } },
    { opId: rid("op"), entity: "Stage", id: stageId, op: "create", fields: { projectId, name: "Étape hors ligne" } },
    { opId: rid("op"), entity: "Task", id: taskId, op: "create", fields: { stageId, name: "Tâche hors ligne", priority: "HIGH" } },
    { opId: rid("op"), entity: "MindMap", id: mapId, op: "create", fields: { title: "Carte hors ligne", rootId } },
    { opId: rid("op"), entity: "MindNode", id: nodeId, op: "create", fields: { mapId, parentId: rootId, title: "Idée hors ligne", status: "WATCH" } },
    { opId: rid("op"), entity: "MindNodeTask", id: `${nodeId}:${taskId}`, op: "create" },
  ];
  {
    const res = await A.push(ops);
    check("6 créations appliquées", res.every((r) => r.status === "applied"), res);
    check("la tâche créée revient avec son état serveur (projet déduit)", res[2].data?.projectId === projectId && typeof res[2].seqs?.["*"] === "number", res[2]);
    const again = await A.push(ops);
    check("renvoi des mêmes opérations : mêmes résultats, aucun doublon", again.every((r, i) => r.status === res[i].status));
    const proj = await A.call<{ project: { stages: Array<{ tasks: unknown[] }> } }>("GET", `/projects/${projectId}`);
    check("une seule étape et une seule tâche côté serveur", proj.data.project.stages.length === 1 && proj.data.project.stages[0].tasks.length === 1, proj.data);
    const bad = await A.push([{ opId: rid("op"), entity: "Task", id: rid(), op: "create", fields: { stageId: "inexistant", name: "x" } }]);
    check("création invalide → rejected (404)", bad[0].status === "rejected" && bad[0].error?.code === "NOT_FOUND", bad);
    const badId = await A.push([{ opId: rid("op"), entity: "Task", id: "a b", op: "create", fields: { name: "x" } }]);
    check("identifiant client invalide → rejected", badId[0].status === "rejected", badId);
  }

  console.log("\n3. Instantané et périmètre");
  {
    const snap = await A.sync();
    check("instantané : curseur fourni", snap.snapshot && typeof snap.cursor === "number" && snap.cursor > 0, { cursor: snap.cursor });
    check("instantané : projet, étape, tâche, carte, nœuds, lien, membre", ["Project|" + projectId, "Stage|" + stageId, "Task|" + taskId, "MindMap|" + mapId, "MindNode|" + rootId, "MindNode|" + nodeId, "MindNodeTask|" + `${nodeId}:${taskId}`].every((k) => A.rows.has(k)) && [...A.rows.keys()].some((k) => k.startsWith("ProjectMember|")));
    check("notes du projet synchronisées", A.get("Project", projectId)?.data.notes === "<p>Notes hors ligne</p>");
    check("versions de champs présentes", (A.get("Task", taskId)?.seqs["*"] ?? 0) > 0);
    check("périmètre : projet et carte", snap.scope.projectIds.includes(projectId) && snap.scope.mapIds.includes(mapId));
    const snapB = await B.sync();
    check("B ne voit rien du projet de A", !snapB.scope.projectIds.includes(projectId) && !B.rows.has("Task|" + taskId));
    const doc = [...A.rows.entries()].find(([k]) => k.startsWith("Document|"));
    check("aucun chemin de stockage exposé", !doc || !("storagePath" in doc[1].data));
  }

  console.log("\n4. Équipe : B rejoint le projet");
  {
    const add = await A.call<{ project: { members: Array<{ id: string; userId: string | null }> } }>("POST", `/projects/${projectId}/members`, { userId: B.userId });
    check("B ajouté à l'équipe", add.status === 201, add);
    const inc = await B.sync();
    check("B voit le projet dans son périmètre", inc.scope.projectIds.includes(projectId));
    // Nouveau projet dans le périmètre : instantané ciblé.
    const one = await B.call<Pull>("GET", `/sync/pull?project=${projectId}`, undefined, { "X-Sync-Protocol": PROTOCOL });
    B.apply(one.data);
    check("instantané ciblé : tâche reçue, curseur inchangé", B.rows.has("Task|" + taskId) && one.data.cursor === null);
  }

  console.log("\n5. Écriture web journalisée et récupérée au curseur");
  {
    const before = A.cursor;
    const r = await B.call("PATCH", `/tasks/${taskId}`, { description: "écrit depuis le web" });
    check("PATCH web ok", r.status === 200, r);
    const inc = await A.sync();
    const ch = inc.changes.find((c) => c.entity === "Task" && c.id === taskId);
    check("A reçoit la modification au curseur suivant", !!ch && ch.data?.description === "<p>écrit depuis le web</p>" && A.cursor > before, inc);
    check("seule la version du champ modifié avance", (ch?.seqs?.description ?? 0) > (ch?.seqs?.name ?? 0), ch?.seqs);
  }

  console.log("\n6. Conflit par champ (le serveur gagne, les autres champs passent)");
  {
    await B.sync();
    // A et B partent de la même version ; B modifie le nom en premier.
    const baseA = A.base("Task", taskId, ["name", "dueDate"]);
    const rB = await B.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { name: "Nom par B" }, base: B.base("Task", taskId, ["name"]) }]);
    check("B applique son nom", rB[0].status === "applied", rB);
    const rA = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { name: "Nom par A", dueDate: "2026-12-31" }, base: baseA }]);
    check("A : conflit sur le nom", rA[0].status === "conflict" && rA[0].conflicts?.[0]?.field === "name" && rA[0].conflicts?.[0]?.serverValue === "Nom par B", rA);
    check("A : l'échéance (champ libre) est appliquée", String(rA[0].data?.dueDate ?? "").startsWith("2026-12-31"), rA[0].data);
    // Deux modifications successives du même champ par A, avec les versions renvoyées : pas de conflit avec soi-même.
    const s1 = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { priority: "LOW" }, base: { priority: Math.max(rA[0].seqs?.priority ?? 0, rA[0].seqs?.["*"] ?? 0) } }]);
    const s2 = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { priority: "CRITICAL" }, base: { priority: s1[0].seqs?.priority ?? 0 } }]);
    check("deux écritures successives du même champ par A : pas de faux conflit", s1[0].status === "applied" && s2[0].status === "applied", { s1, s2 });
    const notes = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { notes: "<p>Notes tâche</p><script>x</script>" }, base: { notes: s2[0].seqs?.["*"] ?? 0 } }]);
    check("notes de tâche via push, assainies", notes[0].status === "applied" && notes[0].data?.notes === "<p>Notes tâche</p>", notes[0].data?.notes);
    const status = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { status: "CLOSED" }, base: { status: notes[0].seqs?.status ?? notes[0].seqs?.["*"] ?? 0 } }]);
    check("règles métier appliquées (clôture → 100 % et date de clôture)", status[0].data?.progress === 100 && !!status[0].data?.closedAt, status[0].data);
  }

  console.log("\n7. Suppression contre modification");
  {
    await A.sync();
    await B.sync();
    // B modifie la tâche ; A, avec une version plus ancienne, tente de la supprimer → refus.
    const staleA = A.base("Task", taskId, []);
    await B.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { description: "modifiée par B" }, base: B.base("Task", taskId, ["description"]) }]);
    const del = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "delete", base: staleA }]);
    check("suppression refusée si modifiée depuis (l'objet revient)", del[0].status === "conflict", del);
    // B supprime la tâche ; A la modifie hors ligne → la suppression gagne.
    await B.sync();
    const delB = await B.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "delete", base: B.base("Task", taskId, []) }]);
    check("suppression à jour appliquée", delB[0].status === "applied", delB);
    const upd = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "update", fields: { name: "trop tard" }, base: A.base("Task", taskId, ["name"]) }]);
    check("modification d'un objet supprimé → conflit deleted", upd[0].status === "conflict" && upd[0].deleted === true, upd);
    const inc = await A.sync();
    check("A reçoit la suppression (et celle du lien nœud ↔ tâche)", inc.changes.some((c) => c.entity === "Task" && c.id === taskId && c.op === "delete") && !A.rows.has("Task|" + taskId));
    const again = await A.push([{ opId: rid("op"), entity: "Task", id: taskId, op: "delete", base: {} }]);
    check("supprimer un objet déjà supprimé → applied (idempotent)", again[0].status === "applied");
  }

  console.log("\n8. Carte mentale : déplacement, statut, position");
  {
    await A.sync();
    const childId = rid();
    const c = await A.push([{ opId: rid("op"), entity: "MindNode", id: childId, op: "create", fields: { mapId, parentId: nodeId, title: "Sous-idée" } }]);
    const v = c[0].seqs ?? {};
    const vf = (f: string) => Math.max(v[f] ?? 0, v["*"] ?? 0);
    const u = await A.push([{ opId: rid("op"), entity: "MindNode", id: childId, op: "update", fields: { parentId: rootId, x: 120, y: -40, status: "CLOSED" }, base: { parentId: vf("parentId"), x: vf("x"), y: vf("y"), status: vf("status") } }]);
    check("création puis déplacement / position / statut (versions renvoyées par la création)", c[0].status === "applied" && u[0].status === "applied" && u[0].data?.parentId === rootId && u[0].data?.x === 120 && u[0].data?.status === "CLOSED", { c, u });
    const stale = await A.push([{ opId: rid("op"), entity: "MindNode", id: childId, op: "update", fields: { title: "version périmée" }, base: { title: 0 } }]);
    check("version antérieure à la création → conflit (le client doit fusionner création et modifications)", stale[0].status === "conflict", stale);
    const delMap = await A.push([{ opId: rid("op"), entity: "MindMap", id: mapId, op: "delete", base: { "*": Number.MAX_SAFE_INTEGER } }]);
    check("suppression de la carte", delMap[0].status === "applied", delMap);
    const inc = await A.sync();
    check("carte retirée du périmètre", !inc.scope.mapIds.includes(mapId));
  }

  console.log("\n9. Retrait de l'équipe : le projet sort du périmètre de B");
  {
    const proj = await A.call<{ project: { members: Array<{ id: string; userId: string | null }> } }>("GET", `/projects/${projectId}`);
    const memberB = proj.data.project.members.find((m) => m.userId === B.userId)!;
    await A.call("DELETE", `/members/${memberB.id}`);
    const inc = await B.sync();
    check("périmètre de B sans le projet (le client purge)", !inc.scope.projectIds.includes(projectId));
    const forbidden = await B.push([{ opId: rid("op"), entity: "Project", id: projectId, op: "update", fields: { name: "pirate" }, base: { "*": Number.MAX_SAFE_INTEGER, name: Number.MAX_SAFE_INTEGER } }]);
    check("B ne peut plus modifier le projet (vu comme supprimé)", forbidden[0].status === "conflict" && forbidden[0].deleted === true, forbidden);
  }

  console.log("\n10. Nettoyage");
  {
    const r = await A.call("DELETE", `/projects/${projectId}`);
    check("projet de test supprimé", r.status === 200, r);
  }

  console.log(`\n${passes} vérification(s) réussie(s), ${failures} échec(s).`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
