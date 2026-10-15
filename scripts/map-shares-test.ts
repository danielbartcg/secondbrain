/**
 * Tests de bout en bout : partage des cartes mentales (lecture / écriture).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:map-shares                     # http://localhost:3000
 *
 * Crée des comptes jetables directement en base (sessions à jeton haché),
 * appelle l'API en Bearer, puis nettoie tout (les cartes partent avec leur
 * propriétaire).
 *
 *   A : propriétaire ; B : lecture ; C : écriture ; D : aucun partage.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const PROTOCOL = "2";
const prisma = new PrismaClient();

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
const tag = randomBytes(4).toString("hex");
const rid = (p: string) => `${p}${randomBytes(8).toString("hex")}`;

type U = { id: string; email: string; token: string; name: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string): Promise<U> {
  const email = `share-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "map-shares-test" } });
  return { id: user.id, email, token, name: user.name };
}

async function call<T = Any>(u: U, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data: data as T };
}

const denied = (s: number) => s === 403 || s === 404;

async function main() {
  console.log(`Partage des cartes — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bob");
  const C = await makeUser("Carla");
  const D = await makeUser("Dan");
  const users = [A.id, B.id, C.id, D.id];

  try {
    console.log("\n1. Création et partage");
    const created = await call(A, "POST", "/mindmaps", { title: `Carte partagée ${tag}` });
    check("A crée une carte", created.status === 201, created);
    const map = created.data.mindmap;
    const mapId: string = map.id;
    check("DTO : access owner, owner null, sharedWith 0", map.access === "owner" && map.owner === null && map.sharedWith === 0, map);
    const child = await call(A, "POST", `/mindmaps/${mapId}/nodes`, { parentId: map.rootId, title: `Nœud zorglub ${tag}` });
    const nodeId: string = child.data.node.id;

    const sB = await call(A, "POST", `/mindmaps/${mapId}/shares`, { userId: B.id, permission: "READ" });
    check("A partage en lecture avec B (par id)", sB.status === 201 && sB.data.shares.some((s: Any) => s.userId === B.id && s.permission === "READ"), sB);
    const sC = await call(A, "POST", `/mindmaps/${mapId}/shares`, { email: C.email.toUpperCase(), permission: "WRITE" });
    check("A partage en écriture avec C (par e-mail)", sC.status === 201 && sC.data.shares.some((s: Any) => s.userId === C.id && s.permission === "WRITE"), sC);
    const self = await call(A, "POST", `/mindmaps/${mapId}/shares`, { userId: A.id, permission: "READ" });
    check("partager avec soi-même est refusé (400)", self.status === 400, self);
    const ghost = await call(A, "POST", `/mindmaps/${mapId}/shares`, { email: `nobody-${tag}@test.local`, permission: "READ" });
    check("destinataire inconnu → 404", ghost.status === 404, ghost);
    const both = await call(A, "POST", `/mindmaps/${mapId}/shares`, { userId: B.id, email: B.email, permission: "READ" });
    check("userId et email ensemble → 400", both.status === 400, both);

    const nB = await prisma.notification.findMany({ where: { userId: B.id, type: "MAP_SHARED" } });
    const nC = await prisma.notification.findMany({ where: { userId: C.id, type: "MAP_SHARED" } });
    const nA = await prisma.notification.findMany({ where: { userId: A.id, type: "MAP_SHARED" } });
    check("notification MAP_SHARED pour B (lecture)", nB.length === 1 && nB[0].title.includes("(lecture)") && nB[0].href === `/mindmaps/${mapId}`, nB);
    check("notification MAP_SHARED pour C (écriture)", nC.length === 1 && nC[0].title.includes("(écriture)"), nC);
    check("pas de notification pour le propriétaire", nA.length === 0, nA);

    const listA = await call(A, "GET", `/mindmaps/${mapId}/shares`);
    check("A liste les partages (2)", listA.status === 200 && listA.data.shares.length === 2, listA);
    const ownerMap = await call(A, "GET", `/mindmaps/${mapId}`);
    check("A : sharedWith = 2", ownerMap.data.mindmap.sharedWith === 2, ownerMap.data.mindmap);

    console.log("\n2. Lecture seule (B)");
    const gB = await call(B, "GET", `/mindmaps/${mapId}`);
    check("B lit la carte et ses nœuds", gB.status === 200 && gB.data.mindmap.nodes.some((n: Any) => n.id === nodeId), gB.status);
    check("B : access read, owner = A", gB.data.mindmap?.access === "read" && gB.data.mindmap?.owner?.id === A.id && gB.data.mindmap?.owner?.name === A.name && gB.data.mindmap?.sharedWith === 0, gB.data.mindmap);
    const lB = await call(B, "GET", "/mindmaps");
    const inListB = lB.data.mindmaps?.find((m: Any) => m.id === mapId);
    check("la liste de B contient la carte partagée (access, owner)", inListB?.access === "read" && inListB?.owner?.id === A.id, inListB);
    check("B lit les tâches d'un nœud", (await call(B, "GET", `/mindmaps/${mapId}/nodes/${nodeId}/tasks`)).status === 200);
    const mutations: Array<[string, string, string, unknown?]> = [
      ["créer un nœud", "POST", `/mindmaps/${mapId}/nodes`, { parentId: map.rootId, title: "Intrus" }],
      ["modifier un nœud", "PATCH", `/mindmaps/${mapId}/nodes/${nodeId}`, { title: "Piraté" }],
      ["déplacer un nœud", "POST", `/mindmaps/${mapId}/nodes/${nodeId}/move`, { parentId: map.rootId, index: 0 }],
      ["supprimer un nœud", "DELETE", `/mindmaps/${mapId}/nodes/${nodeId}`],
      ["renommer la carte", "PATCH", `/mindmaps/${mapId}`, { title: "Piratée" }],
      ["réinitialiser la mise en page", "DELETE", `/mindmaps/${mapId}/layout`],
      ["enregistrer les notes d'un nœud", "PATCH", `/notes/node/${nodeId}`, { notes: "<p>x</p>" }],
      ["enregistrer les notes de la carte", "PATCH", `/notes/mindmap/${mapId}`, { notes: "<p>x</p>" }],
      ["supprimer la carte", "DELETE", `/mindmaps/${mapId}`],
      ["gérer les partages", "GET", `/mindmaps/${mapId}/shares`],
      ["partager à son tour", "POST", `/mindmaps/${mapId}/shares`, { userId: D.id, permission: "READ" }],
      ["créer une tâche rattachée au nœud", "POST", "/tasks", { name: "Tâche intruse", nodeId }],
    ];
    for (const [label, method, path, body] of mutations) {
      const r = await call(B, method, path, body);
      check(`B ne peut pas ${label} (${r.status})`, denied(r.status), r.data);
    }
    const docB = await call(B, "GET", `/notes/node/${nodeId}`);
    check("B lit le document de notes du nœud (non éditable)", docB.status === 200 && docB.data.document?.editable === false, docB.data);
    const treeB = await call(B, "GET", "/notes/tree?parent=section:mindmaps");
    check("la carte apparaît dans « Prise de notes » de B", treeB.data.children?.some((c: Any) => c.id === mapId), treeB.data);
    const unchanged = await prisma.mindNode.findUnique({ where: { id: nodeId } });
    check("le nœud n'a pas été modifié par B", unchanged?.title === `Nœud zorglub ${tag}`, unchanged);

    console.log("\n3. Écriture (C)");
    const gC = await call(C, "GET", `/mindmaps/${mapId}`);
    check("C : access write", gC.data.mindmap?.access === "write", gC.data.mindmap);
    const cN = await call(C, "POST", `/mindmaps/${mapId}/nodes`, { parentId: map.rootId, title: "Ajout de C" });
    check("C crée un nœud", cN.status === 201, cN);
    const cNodeId: string = cN.data.node?.id;
    check("C modifie un nœud", (await call(C, "PATCH", `/mindmaps/${mapId}/nodes/${nodeId}`, { color: "#1f9d55" })).status === 200);
    check("C déplace un nœud", (await call(C, "POST", `/mindmaps/${mapId}/nodes/${cNodeId}/move`, { parentId: nodeId })).status === 200);
    const notesC = await call(C, "PATCH", `/notes/node/${nodeId}`, { notes: "<p>Notes de C</p><script>x</script>" });
    check("C enregistre les notes d'un nœud (assainies)", notesC.status === 200 && notesC.data.document?.notes === "<p>Notes de C</p>" && notesC.data.document?.editable === true, notesC.data);
    check("C renomme la carte", (await call(C, "PATCH", `/mindmaps/${mapId}`, { title: `Carte partagée ${tag} (C)` })).status === 200);
    const taskC = await call(C, "POST", "/tasks", { name: `Tâche de C ${tag}`, nodeId: cNodeId });
    check("C crée une tâche rattachée à un nœud", taskC.status === 201 || taskC.status === 200, taskC);
    const nodeTasksA = await call(A, "GET", `/mindmaps/${mapId}/nodes/${cNodeId}/tasks`);
    check("A ne voit pas la tâche personnelle de C (filtrage d'accès aux tâches)", nodeTasksA.status === 200 && nodeTasksA.data.taskCount === 0, nodeTasksA.data);
    for (const [label, method, path, body] of [
      ["supprimer la carte", "DELETE", `/mindmaps/${mapId}`],
      ["lister les partages", "GET", `/mindmaps/${mapId}/shares`],
      ["changer un droit", "PATCH", `/mindmaps/${mapId}/shares/${B.id}`, { permission: "WRITE" }],
      ["retirer B", "DELETE", `/mindmaps/${mapId}/shares/${B.id}`],
    ] as Array<[string, string, string, unknown?]>) {
      const r = await call(C, method, path, body);
      check(`C ne peut pas ${label} (${r.status})`, r.status === 403, r.data);
    }

    console.log("\n4. Sans partage (D)");
    check("D : la carte est introuvable (404)", (await call(D, "GET", `/mindmaps/${mapId}`)).status === 404);
    check("D : modification → 404", (await call(D, "PATCH", `/mindmaps/${mapId}/nodes/${nodeId}`, { title: "x" })).status === 404);
    check("D : notes → 404", (await call(D, "GET", `/notes/node/${nodeId}`)).status === 404);
    const lD = await call(D, "GET", "/mindmaps");
    check("D : la carte n'est pas dans sa liste", !lD.data.mindmaps?.some((m: Any) => m.id === mapId), lD.data);

    console.log("\n5. Épingles et recherche");
    const pinB = await call(B, "PUT", "/me/pins", { kind: "MINDMAP", id: mapId, pinned: true });
    check("B épingle la carte partagée", pinB.status === 200 && pinB.data.pins?.mindmaps.some((m: Any) => m.id === mapId), pinB);
    const pinD = await call(D, "PUT", "/me/pins", { kind: "MINDMAP", id: mapId, pinned: true });
    check("D ne peut pas l'épingler (404)", pinD.status === 404, pinD);
    const searchB = await call(B, "GET", `/search?q=zorglub ${tag}&kinds=node,mindmap`);
    check("la recherche de B trouve le nœud de la carte partagée", searchB.data.results?.some((h: Any) => h.kind === "node" && h.id === nodeId), searchB.data);
    const searchD = await call(D, "GET", `/search?q=zorglub ${tag}&kinds=node`);
    check("la recherche de D ne le trouve pas", !searchD.data.results?.some((h: Any) => h.id === nodeId), searchD.data);

    console.log("\n6. Synchronisation hors ligne");
    const pullB = await call(B, "GET", "/sync/pull", undefined, { "X-Sync-Protocol": PROTOCOL });
    const ch = (pullB.data.changes ?? []) as Any[];
    check("pull de B : la carte est dans le périmètre", pullB.status === 200 && pullB.data.scope?.mapIds.includes(mapId), pullB.status);
    const mapRow = ch.find((c) => c.entity === "MindMap" && c.id === mapId);
    check("pull de B : carte avec ownerName", mapRow?.data?.ownerName === A.name, mapRow);
    check("pull de B : nœuds de la carte", ch.some((c) => c.entity === "MindNode" && c.id === nodeId));
    const shareRows = ch.filter((c) => c.entity === "MindMapShare" && c.data?.mapId === mapId);
    check("pull de B : seulement son propre partage", shareRows.length === 1 && shareRows[0].id === `${mapId}:${B.id}` && shareRows[0].data.permission === "READ", shareRows);
    const pullA = await call(A, "GET", "/sync/pull", undefined, { "X-Sync-Protocol": PROTOCOL });
    check("pull de A : tous les partages de sa carte", (pullA.data.changes as Any[]).filter((c) => c.entity === "MindMapShare" && c.data?.mapId === mapId).length === 2);
    const pullD = await call(D, "GET", "/sync/pull", undefined, { "X-Sync-Protocol": PROTOCOL });
    check("pull de D : carte hors périmètre", !pullD.data.scope?.mapIds.includes(mapId) && !(pullD.data.changes as Any[]).some((c) => c.entity === "MindNode" && c.id === nodeId));

    const nodeSeqs = ch.find((c) => c.entity === "MindNode" && c.id === nodeId)?.seqs ?? {};
    const base = { title: Math.max(nodeSeqs.title ?? 0, nodeSeqs["*"] ?? 0, ...Object.values(nodeSeqs as Record<string, number>)), "*": Math.max(0, ...Object.values(nodeSeqs as Record<string, number>)) };
    const pushB = await call(B, "POST", "/sync/push", { ops: [{ opId: rid("op"), entity: "MindNode", id: nodeId, op: "update", fields: { title: "Hors ligne B" }, base }] }, { "X-Sync-Protocol": PROTOCOL });
    check("push de B (lecture) : modification refusée", pushB.status === 200 && pushB.data.results?.[0]?.status === "rejected", pushB.data);
    const pushB2 = await call(B, "POST", "/sync/push", { ops: [{ opId: rid("op"), entity: "MindNode", id: rid("n"), op: "create", fields: { mapId, parentId: map.rootId, title: "Création B" } }] }, { "X-Sync-Protocol": PROTOCOL });
    check("push de B (lecture) : création refusée", pushB2.data.results?.[0]?.status === "rejected", pushB2.data);
    const pullC = await call(C, "GET", "/sync/pull", undefined, { "X-Sync-Protocol": PROTOCOL });
    const cSeqs = (pullC.data.changes as Any[]).find((c) => c.entity === "MindNode" && c.id === nodeId)?.seqs ?? {};
    const cBase = { title: Math.max(0, ...Object.values(cSeqs as Record<string, number>)), "*": Math.max(0, ...Object.values(cSeqs as Record<string, number>)) };
    const pushC = await call(C, "POST", "/sync/push", { ops: [{ opId: rid("op"), entity: "MindNode", id: nodeId, op: "update", fields: { title: "Hors ligne C" }, base: cBase }] }, { "X-Sync-Protocol": PROTOCOL });
    check("push de C (écriture) : modification appliquée", pushC.data.results?.[0]?.status === "applied" && pushC.data.results?.[0]?.data?.title === "Hors ligne C", pushC.data);
    const pushShare = await call(C, "POST", "/sync/push", { ops: [{ opId: rid("op"), entity: "MindMapShare", id: `${mapId}:${D.id}`, op: "create", fields: { permission: "WRITE" } }] }, { "X-Sync-Protocol": PROTOCOL });
    check("MindMapShare n'est pas modifiable par la synchro (400)", pushShare.status === 400, pushShare.data);
    const delC = await call(C, "POST", "/sync/push", { ops: [{ opId: rid("op"), entity: "MindMap", id: mapId, op: "delete", base: { "*": 1e12 } }] }, { "X-Sync-Protocol": PROTOCOL });
    check("push de C : suppression de la carte refusée", delC.data.results?.[0]?.status === "rejected", delC.data);

    console.log("\n7. Changement de droit, retrait, départ");
    const curB = Number(pullB.data.cursor);
    const up = await call(A, "PATCH", `/mindmaps/${mapId}/shares/${B.id}`, { permission: "WRITE" });
    check("A passe B en écriture", up.status === 200 && up.data.shares.find((s: Any) => s.userId === B.id)?.permission === "WRITE", up);
    const incB = await call(B, "GET", `/sync/pull?cursor=${curB}`, undefined, { "X-Sync-Protocol": PROTOCOL });
    check("pull incrémental de B : partage mis à jour", (incB.data.changes as Any[]).some((c) => c.entity === "MindMapShare" && c.id === `${mapId}:${B.id}` && c.data?.permission === "WRITE"), incB.data.changes);
    check("B peut maintenant modifier", (await call(B, "PATCH", `/mindmaps/${mapId}/nodes/${nodeId}`, { title: "Par B" })).status === 200);
    const nB2 = await prisma.notification.count({ where: { userId: B.id, type: "MAP_SHARED" } });
    check("B notifié du changement de droit", nB2 === 2, nB2);

    const un = await call(A, "DELETE", `/mindmaps/${mapId}/shares/${B.id}`);
    check("A retire B", un.status === 200 && !un.data.shares.some((s: Any) => s.userId === B.id), un);
    check("B n'a plus accès (404)", (await call(B, "GET", `/mindmaps/${mapId}`)).status === 404);
    const pinsB = await call(B, "GET", "/me/pins");
    check("l'épingle de B a disparu", !pinsB.data.pins?.mindmaps.some((m: Any) => m.id === mapId), pinsB.data);
    const incB2 = await call(B, "GET", `/sync/pull?cursor=${curB}`, undefined, { "X-Sync-Protocol": PROTOCOL });
    check("pull de B : carte sortie du périmètre", !incB2.data.scope?.mapIds.includes(mapId));

    const leave = await call(C, "DELETE", `/mindmaps/${mapId}/shares/${C.id}`);
    check("C quitte la carte", leave.status === 200 && leave.data.ok === true, leave);
    check("C n'a plus accès (404)", (await call(C, "GET", `/mindmaps/${mapId}`)).status === 404);
    const leaveAgain = await call(C, "DELETE", `/mindmaps/${mapId}/shares/${C.id}`);
    check("quitter à nouveau → 404", leaveAgain.status === 404, leaveAgain);
    const after = await call(A, "GET", `/mindmaps/${mapId}/shares`);
    check("plus aucun partage", after.data.shares.length === 0, after.data);

    check("A supprime la carte", (await call(A, "DELETE", `/mindmaps/${mapId}`)).status === 200);
  } finally {
    await prisma.task.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
