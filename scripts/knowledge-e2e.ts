/**
 * Tests de bout en bout (API) : planning de référence, fraîcheur, liens
 * [[…]] (rétroliens, graphe, suggestions), résurgence, flux iCal et voyage
 * dans le temps — droits d'accès compris (propriétaire, membre, étranger).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:knowledge-e2e                  # http://localhost:3000
 *   BASE_URL=http://localhost:3002 npm run test:knowledge-e2e
 *
 * Crée des comptes jetables directement en base, puis supprime tout.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const prisma = new PrismaClient();
const DAY = 86_400_000;

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

type U = { id: string; email: string; token: string; name: string };
const users: U[] = [];

async function makeUser(label: string): Promise<U> {
  const email = `know-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({ data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + DAY), label: "knowledge-e2e" } });
  const u = { id: user.id, email, token, name: user.name };
  users.push(u);
  return u;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function call(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: Any; text: string; type: string }> {
  const res = await fetch(path.startsWith("http") ? path : BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status: res.status, data, text, type: res.headers.get("content-type") ?? "" };
}

async function main() {
  console.log(`Serveur : ${ORIGIN}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bob");
  const C = await makeUser("Carl");

  // --- Données : projet d'Alice (Bob membre), 2 étapes, 3 tâches, une carte ----------------------
  const p = (await call(A, "POST", "/projects", { name: `Projet ${tag}` })).data.project;
  check("projet créé", p?.id, p);
  await call(A, "POST", `/projects/${p.id}/members`, { userId: B.id });
  const s1 = (await call(A, "POST", `/projects/${p.id}/stages`, { name: "Gros œuvre" })).data.project.stages[0];
  const mk = async (name: string, extra: Record<string, unknown> = {}) => (await call(A, "POST", `/projects/${p.id}/tasks`, { name, stageId: s1.id, ...extra })).data.task;
  const t1 = await mk("Fondations", { startDate: "2026-10-01", dueDate: "2026-10-05" });
  const t2 = await mk("Murs", { startDate: "2026-10-06", dueDate: "2026-10-10", prerequisiteIds: [t1.id] });
  const t3 = await mk("Toiture", { dueDate: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
  check("tâches créées", t1?.id && t2?.id && t3?.id);
  const map = (await call(A, "POST", "/mindmaps", { title: `Carte ${tag}` })).data.mindmap;
  const root = map.nodes.find((n: Any) => n.parentId === null);
  const node = (await call(A, "POST", `/mindmaps/${map.id}/nodes`, { parentId: root.id, title: "Idée" })).data.node;
  check("carte et nœud créés", map?.id && node?.id, node);

  console.log("\nPlanning de référence");
  const bl = await call(A, "POST", `/projects/${p.id}/baselines`, { name: "Lancement" });
  check("référence figée (201)", bl.status === 201 && bl.data.baseline.data.tasks.length === 3, bl.data);
  check("référence : tâches datées comptées", bl.data.baseline.taskCount === 3, bl.data.baseline);
  await call(A, "PATCH", `/tasks/${t2.id}`, { dueDate: "2026-10-14" });
  const got = await call(B, "GET", `/projects/${p.id}/baselines/${bl.data.baseline.id}`);
  check("membre : lecture de la référence, dates figées", got.status === 200 && got.data.baseline.data.tasks.find((t: Any) => t.id === t2.id).dueDate === "2026-10-10", got.data);
  check("étranger : 404", (await call(C, "GET", `/projects/${p.id}/baselines`)).status === 404);
  check("étranger : création refusée", (await call(C, "POST", `/projects/${p.id}/baselines`, { name: "x" })).status === 404);
  const blB = await call(B, "POST", `/projects/${p.id}/baselines`, { name: "Comité" });
  check("membre : peut figer", blB.status === 201);
  check("membre : ne supprime pas la référence d'Alice", (await call(B, "DELETE", `/projects/${p.id}/baselines/${bl.data.baseline.id}`)).status === 403);
  check("liste : plus récente d'abord", (await call(A, "GET", `/projects/${p.id}/baselines`)).data.baselines[0].name === "Comité");
  check("propriétaire : supprime celle de Bob", (await call(A, "DELETE", `/projects/${p.id}/baselines/${blB.data.baseline.id}`)).status === 200);
  check("nom vide refusé", (await call(A, "POST", `/projects/${p.id}/baselines`, { name: "  " })).status === 400);

  console.log("\nFraîcheur");
  const old = new Date(Date.now() - 40 * DAY);
  await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = ${old} WHERE id = ${t3.id}`;
  await prisma.$executeRaw`UPDATE "TaskEvent" SET "createdAt" = ${old} WHERE "taskId" = ${t3.id}`;
  let st = await call(A, "GET", "/me/stale");
  check("tâche endormie listée (40 j)", st.data.stale.tasks.some((t: Any) => t.id === t3.id && t.idleDays >= 39), st.data);
  check("seuil par défaut : 14 j", st.data.stale.days === 14);
  check("tâche récente non listée", !st.data.stale.tasks.some((t: Any) => t.id === t1.id));
  const ps = await call(A, "GET", `/projects/${p.id}/stale`);
  check("fraîcheur du projet : la tâche endormie", Object.keys(ps.data.stale.tasks).includes(t3.id), ps.data);
  check("étranger : fraîcheur du projet 404", (await call(C, "GET", `/projects/${p.id}/stale`)).status === 404);
  check("seuil 60 j : plus endormie", !(await call(A, "GET", "/me/stale?days=60")).data.stale.tasks.some((t: Any) => t.id === t3.id));
  check("seuil invalide refusé", (await call(A, "GET", "/me/stale?days=0")).status === 400);
  await call(A, "POST", `/tasks/${t3.id}/comments`, { body: "On s'y remet" });
  st = await call(A, "GET", "/me/stale");
  check("un commentaire la réveille", !st.data.stale.tasks.some((t: Any) => t.id === t3.id), st.data.stale.tasks);
  const pref = await call(A, "PATCH", "/me", { staleDays: 30 });
  check("préférence staleDays enregistrée", pref.data.profile?.staleDays === 30, pref.data);
  check("préférence hors bornes refusée", (await call(A, "PATCH", "/me", { staleDays: 999 })).status === 400);
  // Projet actif endormi (toutes ses lignes anciennes).
  const p2 = (await call(A, "POST", "/projects", { name: `Dormant ${tag}` })).data.project;
  await prisma.$executeRaw`UPDATE "Project" SET "updatedAt" = ${old} WHERE id = ${p2.id}`;
  await prisma.$executeRaw`UPDATE "ProjectMember" SET "createdAt" = ${old} WHERE "projectId" = ${p2.id}`;
  check("projet actif endormi listé", (await call(A, "GET", "/me/stale")).data.stale.projects.some((x: Any) => x.id === p2.id));

  console.log("\nLiens [[…]]");
  const link = `<p>Voir <a href="/tasks/${t2.id}" data-ref="task:${t2.id}" target="_blank">Murs</a> et <a href="/mindmaps/${map.id}?node=${node.id}" data-ref="node:${node.id}">Idée</a>.</p>`;
  const saved = await call(A, "PATCH", `/notes/task/${t1.id}`, { notes: link });
  check("notes enregistrées avec data-ref", saved.data.document?.notes.includes(`data-ref="task:${t2.id}"`) && !saved.data.document.notes.includes('target="_blank"'), saved.data);
  const forged = await call(A, "PATCH", `/notes/task/${t3.id}`, { notes: `<p><a href="https://evil.example" data-ref="task:${t2.id}">x</a><a href="/x" data-ref="task:1 onmouseover=1">y</a></p>` });
  check("data-ref retiré d'un lien externe ou invalide", !forged.data.document.notes.includes("data-ref"), forged.data.document?.notes);
  let bk = await call(A, "GET", `/links/backlinks?ref=task:${t2.id}`);
  check("rétroliens : « Murs » est mentionnée dans « Fondations »", bk.data.items.length === 1 && bk.data.items[0].ref === `task:${t1.id}` && bk.data.items[0].excerpt.includes("Voir"), bk.data);
  check("rétroliens d'un nœud", (await call(A, "GET", `/links/backlinks?ref=node:${node.id}`)).data.items.length === 1);
  check("membre : voit le rétrolien", (await call(B, "GET", `/links/backlinks?ref=task:${t2.id}`)).data.items.length === 1);
  check("étranger : aucun rétrolien", (await call(C, "GET", `/links/backlinks?ref=task:${t2.id}`)).data.items.length === 0);
  check("référence invalide : liste vide", (await call(A, "GET", `/links/backlinks?ref=evil`)).data.items.length === 0);
  // Lien depuis le nœud de carte vers le projet (notes de carte via le métier des cartes).
  await call(A, "PATCH", `/mindmaps/${map.id}/nodes/${node.id}`, { notes: `<p>Rattaché à <a href="/projects/${p.id}" data-ref="project:${p.id}">projet</a></p>` });
  bk = await call(A, "GET", `/links/backlinks?ref=project:${p.id}`);
  check("rétrolien depuis un nœud de carte", bk.data.items.some((x: Any) => x.ref === `node:${node.id}` && x.href.includes(`node=${node.id}`)), bk.data);
  const g = await call(A, "GET", "/links/graph");
  const edges = g.data.graph.edges as { from: string; to: string }[];
  check("graphe : arêtes des liens", edges.some((e) => e.from === `task:${t1.id}` && e.to === `task:${t2.id}`) && edges.some((e) => e.from === `node:${node.id}` && e.to === `project:${p.id}`), g.data);
  check("graphe : objets titrés", g.data.graph.nodes.some((n: Any) => n.ref === `task:${t2.id}` && n.title === "Murs"));
  const gC = await call(C, "GET", "/links/graph");
  check("étranger : graphe vide", gC.data.graph.nodes.length === 0, gC.data);
  const sug = await call(A, "GET", `/links/suggest?q=Mur`);
  check("suggestions : la tâche « Murs »", sug.data.items.some((x: Any) => x.ref === `task:${t2.id}` && x.href === `/tasks/${t2.id}`), sug.data);
  check("suggestions : rien pour l'étranger", (await call(C, "GET", `/links/suggest?q=Mur`)).data.items.length === 0);

  console.log("\nRésurgence");
  await call(A, "PATCH", `/notes/project/${p.id}`, { notes: "<p>Les décisions du lancement : budget validé, planning serré.</p>" });
  await prisma.$executeRaw`UPDATE "Project" SET "updatedAt" = ${old} WHERE id = ${p.id}`;
  await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = ${old} WHERE id = ${t1.id}`;
  let rs = await call(A, "GET", "/me/resurface");
  const refs = (rs.data.items as Any[]).map((x) => x.ref);
  check("notes anciennes proposées (projet et tâche)", refs.includes(`project:${p.id}`) && refs.includes(`task:${t1.id}`), rs.data);
  check("note récente non proposée", !refs.includes(`task:${t3.id}`));
  const first = (rs.data.items as Any[]).find((x) => x.ref === `project:${p.id}`);
  check("extrait lisible", first?.excerpt.startsWith("Les décisions du lancement"), first);
  rs = await call(A, "POST", "/me/resurface", { ref: `project:${p.id}`, answer: "remember" });
  check("relue : retirée de la liste du jour", !(rs.data.items as Any[]).some((x) => x.ref === `project:${p.id}`), rs.data);
  const card = await prisma.resurfaceCard.findUnique({ where: { userId_ref: { userId: A.id, ref: `project:${p.id}` } } });
  check("carte de Leitner : boîte 2, prochain passage dans 10 j", card?.box === 2 && Math.round((card.dueAt.getTime() - Date.now()) / DAY) === 10, card);
  check("étranger : réponse sur une note inaccessible 404", (await call(C, "POST", "/me/resurface", { ref: `project:${p.id}`, answer: "remember" })).status === 404);
  check("réponse invalide refusée", (await call(A, "POST", "/me/resurface", { ref: `project:${p.id}`, answer: "maybe" })).status === 400);
  rs = await call(A, "GET", "/me/resurface");
  check("quota du jour réduit (pas de nouvelle note en remplacement)", (rs.data.items as Any[]).length <= 2, rs.data);

  console.log("\nFlux iCal");
  check("aucun flux au départ", (await call(A, "GET", "/me/calendar")).data.feed.active === false);
  const feed = await call(A, "POST", "/me/calendar");
  check("adresse créée", feed.status === 201 && /^\/api\/v1\/calendar\/cal_[A-Za-z0-9_-]{43}\.ics$/.test(feed.data.path), feed.data);
  await call(A, "POST", `/tasks/${t3.id}/sessions`, { date: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10) }).catch(() => null);
  const ics = await call(null, "GET", ORIGIN + feed.data.path);
  check("flux public : 200 text/calendar", ics.status === 200 && ics.type.startsWith("text/calendar"), { status: ics.status, type: ics.type });
  check("flux : échéance de « Toiture »", ics.text.includes("SUMMARY:Échéance : Toiture") && ics.text.includes(`UID:task-${t3.id}@secondbrain`), ics.text.slice(0, 600));
  check("flux : lien vers la fiche", ics.text.includes(`/tasks/${t3.id}`));
  check("flux : CRLF", ics.text.includes("\r\nEND:VCALENDAR\r\n"));
  check("jeton inconnu : 404", (await call(null, "GET", `/calendar/cal_${"x".repeat(43)}.ics`)).status === 404);
  check("étranger : son propre flux seulement", !(await call(C, "GET", "/me/calendar")).data.feed.active);
  const feed2 = await call(A, "POST", "/me/calendar");
  check("régénération : l'ancienne adresse cesse", (await call(null, "GET", ORIGIN + feed.data.path)).status === 404 && (await call(null, "GET", ORIGIN + feed2.data.path)).status === 200);
  await call(A, "DELETE", "/me/calendar");
  check("révocation : 404", (await call(null, "GET", ORIGIN + feed2.data.path)).status === 404);

  console.log("\nVoyage dans le temps");
  // Historique simulé : la tâche « Murs » existe depuis 20 j, passée en cours il y a 10 j, terminée il y a 2 j.
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  await call(A, "PATCH", `/tasks/${t2.id}`, { status: "IN_PROGRESS" });
  await call(A, "PATCH", `/tasks/${t2.id}`, { status: "DONE" });
  await prisma.$executeRaw`UPDATE "Task" SET "createdAt" = ${ago(20)} WHERE id = ${t2.id}`;
  await prisma.$executeRaw`UPDATE "Project" SET "createdAt" = ${ago(25)} WHERE id = ${p.id}`;
  await prisma.$executeRaw`UPDATE "Stage" SET "createdAt" = ${ago(25)} WHERE id = ${s1.id}`;
  await prisma.$executeRaw`UPDATE "TaskEvent" SET "createdAt" = ${ago(10)} WHERE "taskId" = ${t2.id} AND field = 'status' AND "newValue" = 'En cours'`;
  await prisma.$executeRaw`UPDATE "TaskEvent" SET "createdAt" = ${ago(2)} WHERE "taskId" = ${t2.id} AND field = 'status' AND "newValue" = 'Terminée'`;
  await prisma.$executeRaw`UPDATE "TaskEvent" SET "createdAt" = ${ago(15)} WHERE "taskId" = ${t2.id} AND field = 'dueDate' AND "newValue" = '14/10/2026'`;
  await prisma.$executeRaw`UPDATE "TaskEvent" SET "createdAt" = ${ago(19)} WHERE "taskId" = ${t2.id} AND (kind = 'created' OR (field IN ('dueDate', 'startDate', 'prerequisiteIds', 'attachment') AND "newValue" IS DISTINCT FROM '14/10/2026'))`;
  const day = (d: number) => ago(d).toISOString().slice(0, 10);
  let tt = await call(A, "GET", `/projects/${p.id}/time-travel?at=${day(5)}`);
  const m5 = (tt.data.state?.tasks as Any[] | undefined)?.find((t) => t.id === t2.id);
  check("il y a 5 j : « Murs » en cours", m5?.status === "IN_PROGRESS", tt.data);
  check("il y a 5 j : seule « Murs » existait", tt.data.state.tasks.length === 1 && tt.data.state.since.created === 2, tt.data.state?.since);
  tt = await call(A, "GET", `/projects/${p.id}/time-travel?at=${day(12)}`);
  check("il y a 12 j : à faire, échéance repoussée (14/10, il y a 15 j)", tt.data.state.tasks[0]?.status === "TODO" && tt.data.state.tasks[0]?.dueDate === "2026-10-14", tt.data.state?.tasks);
  tt = await call(A, "GET", `/projects/${p.id}/time-travel?at=${day(17)}`);
  check("il y a 17 j : échéance d'origine (10/10)", tt.data.state.tasks[0]?.dueDate === "2026-10-10", tt.data.state?.tasks);
  tt = await call(A, "GET", `/projects/${p.id}/time-travel`);
  check("aujourd'hui : terminée", tt.data.state.tasks.find((t: Any) => t.id === t2.id)?.status === "DONE");
  check("courbe d'avancement fournie", tt.data.state.curve.length >= 2 && tt.data.state.curve.at(-1).done >= 1, tt.data.state.curve);
  check("étranger : 404", (await call(C, "GET", `/projects/${p.id}/time-travel`)).status === 404);
  check("date invalide : 400", (await call(A, "GET", `/projects/${p.id}/time-travel?at=hier`)).status === 400);
  // Carte : nœud créé il y a 20 j, renommé il y a 3 j ; un nœud supprimé il y a 1 j.
  await call(A, "PATCH", `/mindmaps/${map.id}/nodes/${node.id}`, { title: "Idée finale" });
  const gone = (await call(A, "POST", `/mindmaps/${map.id}/nodes`, { parentId: root.id, title: "Abandonnée" })).data.node;
  await call(A, "DELETE", `/mindmaps/${map.id}/nodes/${gone.id}`);
  await prisma.$executeRaw`UPDATE "MindNode" SET "createdAt" = ${ago(20)} WHERE "mapId" = ${map.id}`;
  await prisma.$executeRaw`UPDATE "MindMap" SET "createdAt" = ${ago(20)} WHERE id = ${map.id}`;
  await prisma.$executeRaw`UPDATE "MapEvent" SET "createdAt" = ${ago(3)} WHERE "mapId" = ${map.id} AND kind = 'node_renamed'`;
  await prisma.$executeRaw`UPDATE "MapEvent" SET "createdAt" = ${ago(15)} WHERE "mapId" = ${map.id} AND kind = 'node_created'`;
  await prisma.$executeRaw`UPDATE "MapEvent" SET "createdAt" = ${ago(1)} WHERE "mapId" = ${map.id} AND kind = 'node_deleted'`;
  const mt = await call(A, "GET", `/mindmaps/${map.id}/time-travel?at=${day(5)}`);
  check("carte il y a 5 j : ancien titre « Idée »", mt.data.state?.nodes.find((n: Any) => n.id === node.id)?.title === "Idée", mt.data);
  check("carte il y a 5 j : nœud supprimé depuis signalé", mt.data.state.deletedSince.some((d: Any) => d.title === "Abandonnée"), mt.data.state?.deletedSince);
  check("carte : étranger 404", (await call(C, "GET", `/mindmaps/${map.id}/time-travel`)).status === 404);
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    // Nettoyage : projets, cartes et comptes jetables (cascades).
    const ids = users.map((u) => u.id);
    await prisma.project.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.mindMap.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.task.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
    process.exit(failures ? 1 : 0);
  });
