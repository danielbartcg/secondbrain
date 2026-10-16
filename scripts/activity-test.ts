/**
 * Tests de bout en bout de la piste d'audit des cartes mentales et du
 * rapport d'activité (/api/v1/mindmaps/:id/history, /api/v1/activity, outils
 * MCP get_activity et get_map_history), plus les fenêtres de temps (pur).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:activity            # http://localhost:3000 (BASE_URL sinon)
 *
 * Crée des comptes jetables directement en base (sessions Bearer), nettoie
 * tout à la fin.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { parisMidnight, presetRange, resolveActivityWindow } from "../src/lib/shared/activity-period";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const prisma = new PrismaClient();

let failures = 0;
let passes = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 1200));
  }
}
const tag = randomBytes(4).toString("hex");
type U = { id: string; email: string; token: string; name: string };
const createdUsers: string[] = [];

async function makeUser(label: string, opts: { admin?: boolean } = {}): Promise<U> {
  const email = `act-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4), role: opts.admin ? "ADMIN" : "USER" },
  });
  createdUsers.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "activity-test" } });
  return { id: user.id, email, token, name: user.name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function call<T = Any>(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
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
async function mcp(key: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const data = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  return { isError: !!data.result?.isError, text: data.result?.content?.[0]?.text ?? "" };
}

async function main() {
  console.log(`Activité et historique des cartes — ${ORIGIN}`);

  console.log("\n1. Fenêtres de temps (pur)");
  const now = new Date("2026-10-16T10:00:00Z"); // vendredi
  check("semaine dernière = lundi 05 → dimanche 11/10", JSON.stringify(presetRange("last_week", now)) === JSON.stringify({ from: "2026-10-05", to: "2026-10-11" }), presetRange("last_week", now));
  check("cette semaine = lundi 12/10 → aujourd'hui", JSON.stringify(presetRange("week", now)) === JSON.stringify({ from: "2026-10-12", to: "2026-10-16" }));
  check("mois dernier = septembre", JSON.stringify(presetRange("last_month", now)) === JSON.stringify({ from: "2026-09-01", to: "2026-09-30" }));
  check("7 derniers jours", JSON.stringify(presetRange("7d", now)) === JSON.stringify({ from: "2026-10-10", to: "2026-10-16" }));
  check("minuit de Paris en été = 22:00 UTC la veille", parisMidnight("2026-07-01").toISOString() === "2026-06-30T22:00:00.000Z", parisMidnight("2026-07-01"));
  check("minuit de Paris en hiver = 23:00 UTC la veille", parisMidnight("2026-12-01").toISOString() === "2026-11-30T23:00:00.000Z");
  const w = resolveActivityWindow({ from: "2026-10-20", to: "2026-10-01" }, now);
  check("dates libres inversées remises dans l'ordre", w.from === "2026-10-01" && w.to === "2026-10-20" && /du 01\/10\/2026 au 20\/10\/2026/.test(w.label), w);
  let err = "";
  try {
    resolveActivityWindow({ from: "2024-01-01", to: "2026-01-01" }, now);
  } catch (e) {
    err = (e as Error).message;
  }
  check("fenêtre trop longue refusée", /trop longue/.test(err), err);

  const A = await makeUser("Alice");
  const B = await makeUser("Bob");
  const C = await makeUser("Chloe");
  try {
    console.log("\n2. Piste d'audit d'une carte");
    const map = await call(A, "POST", "/mindmaps", { title: "Carte audit" });
    const mapId = map.data.mindmap.id as string;
    const rootId = map.data.mindmap.rootId as string;
    const n1 = (await call(A, "POST", `/mindmaps/${mapId}/nodes`, { parentId: rootId, title: "Idée" })).data.node;
    const n2 = (await call(A, "POST", `/mindmaps/${mapId}/nodes`, { parentId: rootId, title: "Autre branche" })).data.node;
    const n3 = (await call(A, "POST", `/mindmaps/${mapId}/nodes`, { parentId: n1.id, title: "Détail" })).data.node;
    await call(A, "PATCH", `/mindmaps/${mapId}/nodes/${n1.id}`, { title: "Piste" });
    await call(A, "PATCH", `/mindmaps/${mapId}/nodes/${n1.id}`, { notes: "<p>Premier jet</p>" });
    await call(A, "PATCH", `/mindmaps/${mapId}/nodes/${n1.id}`, { notes: "<p>Premier jet complété</p>" });
    await call(A, "PATCH", `/mindmaps/${mapId}/nodes/${n1.id}`, { status: "WATCH" });
    await call(A, "PATCH", `/mindmaps/${mapId}/nodes/${n1.id}`, { x: 120, y: 40, collapsed: true });
    await call(A, "POST", `/mindmaps/${mapId}/nodes/${n3.id}/move`, { parentId: n2.id });
    await call(A, "PATCH", `/mindmaps/${mapId}`, { title: "Carte audit v2" });
    await call(A, "POST", `/mindmaps/${mapId}/shares`, { userId: B.id, permission: "WRITE" });
    // B (écriture) supprime une branche.
    const n4 = (await call(B, "POST", `/mindmaps/${mapId}/nodes`, { parentId: n2.id, title: "Feuille" })).data.node;
    const del = await call(B, "DELETE", `/mindmaps/${mapId}/nodes/${n2.id}`);
    check("B (écriture) supprime une branche", del.status === 200 || del.status === 204, del);
    void n4;
    const hist = await call(A, "GET", `/mindmaps/${mapId}/history`);
    const msgs = (hist.data.events as Any[]).map((e) => e.message as string);
    check("historique lisible (200)", hist.status === 200 && msgs.length > 0, hist);
    check("création de la carte", msgs.some((m) => /a créé la carte « Carte audit »/.test(m)), msgs);
    check("nœud ajouté sous son parent", msgs.some((m) => /a ajouté le nœud « Idée » sous « Carte audit »/.test(m)), msgs);
    check("nœud renommé", msgs.some((m) => /a renommé le nœud « Idée » en « Piste »/.test(m)), msgs);
    check("deux enregistrements de notes = une seule séance", msgs.filter((m) => /a modifié les notes du nœud « Piste »/.test(m)).length === 1, msgs);
    check("statut du nœud", msgs.some((m) => /de « ouvert » à « à surveiller »/.test(m)), msgs);
    check("positions et repli non journalisés", !msgs.some((m) => /position|repli/i.test(m)), msgs);
    check("déplacement", msgs.some((m) => /a déplacé le nœud « Détail » de « Piste » vers « Autre branche »/.test(m)), msgs);
    check("carte renommée", msgs.some((m) => /a renommé la carte « Carte audit » en « Carte audit v2 »/.test(m)), msgs);
    check("partage tracé", msgs.some((m) => /a partagé la carte avec Bob Test \(écriture\)/.test(m)), msgs);
    check("suppression de branche par B, avec sa taille", msgs.some((m) => /^Bob Test a supprimé le nœud « Autre branche » et ses 2 sous-nœuds/.test(m)), msgs);
    check("le plus récent d'abord", (hist.data.events as Any[])[0].kind === "node_deleted", (hist.data.events as Any[])[0]);
    const nodeHist = await call(A, "GET", `/mindmaps/${mapId}/history?nodeId=${n1.id}`);
    check("filtre par nœud", nodeHist.status === 200 && (nodeHist.data.events as Any[]).every((e) => e.nodeId === n1.id) && (nodeHist.data.events as Any[]).length >= 4, nodeHist.data);
    check("B (partagé) lit l'historique", (await call(B, "GET", `/mindmaps/${mapId}/history`)).status === 200);
    check("C (sans accès) : 404", (await call(C, "GET", `/mindmaps/${mapId}/history`)).status === 404);

    console.log("\n3. Tâches rattachées aux nœuds");
    const proj = await call(A, "POST", "/projects", { name: "Projet activité" });
    const pid = proj.data.project.id as string;
    const t1 = (await call(A, "POST", `/projects/${pid}/tasks`, { name: "Rédiger le plan", dueDate: "2026-12-01" })).data.task;
    await call(A, "POST", `/mindmaps/${mapId}/nodes/${n1.id}/tasks`, { taskId: t1.id });
    const t2 = (await call(A, "POST", "/tasks", { name: "Depuis le nœud", projectId: pid, nodeId: n1.id })).data.task;
    await call(A, "DELETE", `/mindmaps/${mapId}/nodes/${n1.id}/tasks/${t1.id}`);
    const msgs2 = ((await call(A, "GET", `/mindmaps/${mapId}/history?nodeId=${n1.id}`)).data.events as Any[]).map((e) => e.message as string);
    check("tâche rattachée", msgs2.some((m) => /a rattaché la tâche « Rédiger le plan » au nœud « Piste »/.test(m)), msgs2);
    check("tâche créée depuis le nœud", msgs2.some((m) => /a créé la tâche « Depuis le nœud » depuis le nœud « Piste »/.test(m)), msgs2);
    check("tâche détachée", msgs2.some((m) => /a détaché la tâche « Rédiger le plan » du nœud « Piste »/.test(m)), msgs2);

    console.log("\n4. Rapport d'activité");
    await call(A, "PATCH", `/tasks/${t1.id}`, { status: "DONE" });
    await call(A, "PATCH", `/tasks/${t1.id}`, { dueDate: "2026-12-15" });
    await call(A, "PATCH", `/tasks/${t2.id}`, { status: "CLOSED" });
    await call(A, "POST", `/tasks/${t2.id}/comments`, { body: "Bien avancé" });
    await call(A, "POST", `/projects/${pid}/meetings`, { title: "Point hebdo", date: new Date().toISOString() });
    await call(A, "POST", `/projects/${pid}/risks`, { title: "Retard fournisseur", probability: 4, impact: 4 });
    const form = new FormData();
    form.append("file", new Blob(["contenu"], { type: "text/plain" }), "compte-rendu.txt");
    await fetch(`${BASE}/projects/${pid}/documents`, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: form });
    const act = await call(A, "GET", "/activity?period=today");
    const a = act.data.activity;
    check("rapport du jour (200)", act.status === 200 && !!a, act);
    const p = (a?.projects as Any[] | undefined)?.find((x) => x.id === pid);
    check("projet présent, nouveau sur la période", !!p && p.createdInPeriod === true, p);
    check("compteurs de tâches", p?.counts.tasksCreated === 2 && p?.counts.tasksCompleted === 1 && p?.counts.tasksClosed === 1 && p?.counts.tasksRescheduled >= 1 && p?.counts.comments === 1, p?.counts);
    check("tâche avec ses messages d'audit", p?.tasks.some((t: Any) => t.name === "Rédiger le plan" && t.events.some((e: Any) => /a modifié l'échéance/.test(e.message))), p?.tasks);
    check("réunion, risque et document consolidés", p?.meetings.length === 1 && p?.risks.some((r: Any) => r.title === "Retard fournisseur" && r.created) && p?.documents.some((d: Any) => d.name === "compte-rendu.txt"), { m: p?.meetings, r: p?.risks, d: p?.documents });
    const m = (a?.maps as Any[] | undefined)?.find((x) => x.id === mapId);
    check("carte consolidée (nœuds créés, supprimés, notes)", !!m && m.counts.nodesCreated >= 4 && m.counts.nodesDeleted === 1 && m.counts.notesEdited === 1, m?.counts);
    check("nœud supprimé signalé", m?.nodes.some((n: Any) => n.title === "Autre branche" && n.deleted), m?.nodes);
    check("personnes actives (Alice et Bob)", a?.people.some((x: Any) => x.name === "Alice Test") && a?.people.some((x: Any) => x.name === "Bob Test"), a?.people);
    check("activité par jour", Array.isArray(a?.days) && a.days.length === 1 && a.days[0].tasks > 0 && a.days[0].maps > 0, a?.days);
    const onlyProject = (await call(A, "GET", `/activity?period=today&projectId=${pid}`)).data.activity;
    check("filtre projet : pas de cartes", onlyProject.projects.length === 1 && onlyProject.maps.length === 0, onlyProject);
    const onlyMap = (await call(A, "GET", `/activity?period=7d&mapId=${mapId}`)).data.activity;
    check("filtre carte : pas de projets", onlyMap.projects.length === 0 && onlyMap.maps.length === 1, onlyMap);
    const past = (await call(A, "GET", "/activity?from=2020-01-01&to=2020-01-31")).data.activity;
    check("fenêtre libre passée : vide", past.projects.length === 0 && past.maps.length === 0 && past.days.length === 31, past.totals);
    check("dates invalides : 400", (await call(A, "GET", "/activity?from=01/10/2026")).status === 400);
    check("toute la plateforme refusée à un non-administrateur", (await call(A, "GET", "/activity?all=1")).status === 403);
    const cAct = (await call(C, "GET", "/activity?period=today")).data.activity;
    check("C ne voit rien de A", !cAct.projects.some((x: Any) => x.id === pid) && !cAct.maps.some((x: Any) => x.id === mapId), cAct);
    const bAct = (await call(B, "GET", "/activity?period=today")).data.activity;
    check("B voit la carte partagée, pas le projet de A", bAct.maps.some((x: Any) => x.id === mapId) && !bAct.projects.some((x: Any) => x.id === pid));
    check("projet d'autrui en filtre : 404", (await call(C, "GET", `/activity?projectId=${pid}`)).status === 404);

    console.log("\n5. Connecteur MCP");
    const key = (await call(A, "POST", "/me/api-keys", { name: "Activité", canWrite: false })).data.key as string;
    const r1 = await mcp(key, "get_activity", { period: "today" });
    const parsed = JSON.parse(r1.text || "{}");
    check("get_activity : même rapport", !r1.isError && parsed.projects?.some((x: Any) => x.id === pid) && parsed.maps?.some((x: Any) => x.id === mapId), r1.text.slice(0, 300));
    const r2 = await mcp(key, "get_activity", { from: "2026-10-01", to: "2026-10-31", project_id: pid });
    check("get_activity : fenêtre libre + projet", !r2.isError && JSON.parse(r2.text).label.includes("01/10/2026"), r2.text.slice(0, 200));
    const r3 = await mcp(key, "get_activity", { period: "decennie" });
    check("get_activity : période inconnue → erreur claire", r3.isError && /Période inconnue/.test(r3.text), r3);
    const r4 = await mcp(key, "get_map_history", { map_id: mapId, node_id: n1.id });
    check("get_map_history", !r4.isError && /Piste/.test(r4.text), r4.text.slice(0, 200));

    console.log("\n6. Nettoyage");
    await call(A, "DELETE", `/projects/${pid}`);
    await call(A, "DELETE", `/mindmaps/${mapId}`);
    check("événements de carte supprimés avec la carte", (await prisma.mapEvent.count({ where: { mapId } })) === 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  }
  console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
