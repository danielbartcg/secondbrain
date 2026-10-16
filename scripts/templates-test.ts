/**
 * Tests de bout en bout des modèles (projets types, cartes types) :
 * édition par les administrateurs avec les routes habituelles, exclusion des
 * périmètres, création à partir d'un modèle, application à une cible vide,
 * outils MCP.
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:templates           # http://localhost:3000 (BASE_URL sinon)
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

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
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 1000));
  }
}
const tag = randomBytes(4).toString("hex");
type U = { id: string; token: string };
const createdUsers: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string, admin = false): Promise<U> {
  const user = await prisma.user.create({
    data: { email: `tpl-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4), role: admin ? "ADMIN" : "USER" },
  });
  createdUsers.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "tpl-test" } });
  return { id: user.id, token };
}
async function call<T = Any>(u: U, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  console.log(`Modèles — ${ORIGIN}`);
  const admin = await makeUser("admin", true);
  const bob = await makeUser("bob");
  const carla = await makeUser("carla");
  const toDelete: { projects: string[]; maps: string[] } = { projects: [], maps: [] };
  try {
    console.log("\n1. Projet type : création et édition (routes habituelles)");
    const name = `Déploiement ${tag}`;
    const c = await call(admin, "POST", "/admin/templates/projects", { name });
    const tplId = c.data.project?.id as string;
    toDelete.projects.push(tplId);
    check("création (201, isTemplate)", c.status === 201 && c.data.project.isTemplate === true && c.data.project.members.length === 0, c.data);
    check("non-administrateur : création refusée", (await call(bob, "POST", "/admin/templates/projects", { name: "x" })).status === 403);
    await call(admin, "PATCH", `/projects/${tplId}`, { description: "Description du modèle", color: "#1f9d55" });
    const st = await call(admin, "POST", `/projects/${tplId}/stages`, { name: "Cadrage" });
    check("étape ajoutée au modèle", st.status === 201 || st.status === 200, st);
    const stageId = st.data.project.stages[0].id;
    const act = await call(admin, "POST", `/stages/${stageId}/activities`, { name: "Ateliers" });
    const actId = act.data.project.stages[0].activities[0].id;
    const t1 = (await call(admin, "POST", `/activities/${actId}/tasks`, { name: "Atelier de lancement", priority: "HIGH", complexity: "HIGH" })).data.task;
    const t2 = (await call(admin, "POST", `/stages/${stageId}/tasks`, { name: "Note de cadrage", prerequisiteIds: [t1.id] })).data.task;
    check("tâches et prérequis dans le modèle", !!t1?.id && t2?.prerequisiteIds?.[0] === t1.id, t2);
    await call(admin, "PATCH", `/notes/task/${t1.id}`, { notes: "<p>Ordre du jour type</p>" });
    await call(admin, "POST", `/projects/${tplId}/deliverables`, { name: "Note de cadrage signée", stageId });
    const risk = await call(admin, "POST", `/projects/${tplId}/risks`, { title: "Disponibilité du client", probability: 3, impact: 4, strategy: "MITIGATE" });
    await call(admin, "PUT", `/risks/${risk.data.risks[0].id}/tasks`, { taskIds: [t1.id] });
    await call(admin, "POST", `/projects/${tplId}/folders`, { name: "Livrables" });
    const tpl = await call(admin, "GET", `/projects/${tplId}`);
    check("modèle complet relu par l'administrateur", tpl.status === 200 && tpl.data.project.stages.length === 1 && tpl.data.project.deliverables.length === 1 && tpl.data.project.folders.length === 1, tpl.data.project);

    console.log("\n2. Hors des périmètres");
    check("non-administrateur : modèle introuvable (404)", (await call(bob, "GET", `/projects/${tplId}`)).status === 404);
    check("non-administrateur : écriture impossible", (await call(bob, "POST", `/projects/${tplId}/stages`, { name: "Pirate" })).status === 404);
    check("non-administrateur : tâche du modèle introuvable", (await call(bob, "GET", `/tasks/${t1.id}`)).status === 404);
    check("absent de la liste des projets de l'administrateur", !((await call(admin, "GET", "/projects")).data.projects as Any[]).some((p) => p.id === tplId));
    check("absent de la recherche", !((await call(admin, "GET", `/search?q=${encodeURIComponent("Atelier de lancement")}`)).data.results as Any[]).some((r) => r.id === t1.id));
    check("absent de « Mes tâches »", !((await call(admin, "GET", "/me/tasks")).data.tasks as Any[]).some((t) => t.id === t1.id));
    const pull = await call(admin, "GET", "/sync/pull", undefined, { "X-Sync-Protocol": "2" });
    check("absent de la synchro", pull.status === 200 && !(pull.data.scope.projectIds as string[]).includes(tplId), pull.status);
    check("listé dans /templates pour tous", ((await call(bob, "GET", "/templates")).data.templates.projects as Any[]).some((p) => p.id === tplId && p.taskCount === 2));

    console.log("\n3. Créer un projet à partir du modèle");
    const created = await call(bob, "POST", "/projects", { name: `Client ${tag}`, templateId: tplId });
    const p = created.data.project;
    toDelete.projects.push(p.id);
    check("projet créé (201), pas un modèle", created.status === 201 && p.isTemplate === false, created.data);
    const tasks = p.stages[0].activities[0].tasks.concat(p.stages[0].tasks);
    const nt1 = tasks.find((t: Any) => t.name === "Atelier de lancement");
    const nt2 = tasks.find((t: Any) => t.name === "Note de cadrage");
    check("structure copiée (étape, activité, tâches)", p.stages[0].name === "Cadrage" && p.stages[0].activities[0].name === "Ateliers" && !!nt1 && !!nt2);
    check("nouveaux identifiants, prérequis remappés", nt1.id !== t1.id && nt2.prerequisiteIds[0] === nt1.id, nt2);
    check("priorité / complexité conservées, statut et avancement remis à zéro", nt1.priority === "HIGH" && nt1.complexity === "HIGH" && nt1.status === "TODO" && nt1.progress === 0);
    check("ni dates ni personnes", !nt1.startDate && !nt1.dueDate && !nt1.assigneeId && p.members.length === 1 && p.members[0].userId === bob.id);
    check("description et couleur reprises", p.description === "Description du modèle" && p.color === "#1f9d55");
    check("livrable et dossier copiés", p.deliverables[0]?.name === "Note de cadrage signée" && p.deliverables[0]?.status === "PLANNED" && p.deliverables[0]?.stageId === p.stages[0].id && p.folders[0]?.name === "Livrables", p.deliverables);
    const risks = (await call(bob, "GET", `/projects/${p.id}/risks`)).data.risks as Any[];
    check("risque copié, ouvert, tâche liée remappée", risks.length === 1 && risks[0].status === "OPEN" && risks[0].strategy === "MITIGATE" && risks[0].taskIds[0] === nt1.id, risks);
    const notes = await call(bob, "GET", `/notes/task/${nt1.id}`);
    check("notes de tâche copiées", /Ordre du jour type/.test(notes.data.document?.notes ?? ""), notes.data);
    const hist = await call(bob, "GET", `/tasks/${nt1.id}/history`);
    check("historique : créée depuis le modèle", (hist.data.events as Any[]).some((e) => new RegExp(`modèle « ${name} »`).test(e.message)), hist.data.events);
    check("le modèle n'est pas modifié", ((await call(admin, "GET", `/projects/${tplId}`)).data.project.stages[0].tasks as Any[]).every((t) => t.id !== nt2.id));
    const bad = await call(bob, "POST", "/projects", { name: `Raté ${tag}`, templateId: "inexistant" });
    const leftover = await prisma.project.count({ where: { name: `Raté ${tag}` } });
    check("modèle inconnu : 404 et aucun projet à moitié créé", bad.status === 404 && leftover === 0, { status: bad.status, leftover });

    console.log("\n4. Initialiser un projet vide");
    const empty = (await call(bob, "POST", "/projects", { name: `Vide ${tag}` })).data.project;
    toDelete.projects.push(empty.id);
    await call(bob, "POST", `/projects/${empty.id}/members`, { userId: carla.id });
    check("membre non propriétaire : refusé (403)", (await call(carla, "POST", `/projects/${empty.id}/apply-template`, { templateId: tplId })).status === 403);
    const applied = await call(bob, "POST", `/projects/${empty.id}/apply-template`, { templateId: tplId });
    check("propriétaire : modèle appliqué", applied.status === 200 && applied.data.project.stages.length === 1, applied.data);
    const again = await call(bob, "POST", `/projects/${empty.id}/apply-template`, { templateId: tplId });
    check("projet non vide : refusé (409)", again.status === 409, again.data);

    console.log("\n5. Projet type à partir d'un projet existant");
    const fromP = await call(admin, "POST", "/admin/templates/projects", { name: `Copie ${tag}`, fromProjectId: tplId });
    toDelete.projects.push(fromP.data.project.id);
    check("structure copiée dans un nouveau modèle", fromP.status === 201 && fromP.data.project.isTemplate && fromP.data.project.stages[0]?.name === "Cadrage", fromP.data);
    check("source inaccessible : 404", (await call(admin, "POST", "/admin/templates/projects", { name: "x", fromProjectId: "inexistant" })).status === 404);

    console.log("\n6. Cartes types");
    const mt = await call(admin, "POST", "/admin/templates/maps", { title: `Atelier ${tag}` });
    const mtId = mt.data.mindmap.id as string;
    toDelete.maps.push(mtId);
    check("carte type créée", mt.status === 201 && mt.data.mindmap.isTemplate === true);
    const n1 = (await call(admin, "POST", `/mindmaps/${mtId}/nodes`, { parentId: mt.data.mindmap.rootId, title: "Objectifs" })).data.node;
    await call(admin, "POST", `/mindmaps/${mtId}/nodes`, { parentId: n1.id, title: "Mesurables" });
    await call(admin, "PATCH", `/mindmaps/${mtId}/nodes/${n1.id}`, { notes: "<p>Questions à poser</p>", status: "WATCH" });
    check("non-administrateur : carte type introuvable", (await call(bob, "GET", `/mindmaps/${mtId}`)).status === 404);
    check("absente des cartes de l'administrateur", !((await call(admin, "GET", "/mindmaps")).data.mindmaps as Any[]).some((m) => m.id === mtId));
    const nm = await call(bob, "POST", "/mindmaps", { title: `Ma carte ${tag}`, templateId: mtId });
    toDelete.maps.push(nm.data.mindmap?.id);
    const nodes = nm.data.mindmap?.nodes as Any[];
    const obj = nodes?.find((n) => n.title === "Objectifs");
    check("carte créée à partir du modèle (racine = mon titre)", nm.status === 201 && nodes.find((n) => !n.parentId)?.title === `Ma carte ${tag}` && !!obj && nodes.some((n) => n.title === "Mesurables" && n.parentId === obj.id), nodes);
    check("notes et statut des nœuds copiés", obj?.status === "WATCH" && /Questions/.test(obj?.notes ?? ""));
    const emptyMap = (await call(bob, "POST", "/mindmaps", { title: `Carte vide ${tag}` })).data.mindmap;
    toDelete.maps.push(emptyMap.id);
    const ap = await call(bob, "POST", `/mindmaps/${emptyMap.id}/apply-template`, { templateId: mtId });
    check("carte vide initialisée", ap.status === 200 && (ap.data.mindmap.nodes as Any[]).length === 3, ap.data);
    check("carte non vide : refusé (409)", (await call(bob, "POST", `/mindmaps/${emptyMap.id}/apply-template`, { templateId: mtId })).status === 409);
    const mh = await call(bob, "GET", `/mindmaps/${emptyMap.id}/history`);
    check("historique : modèle appliqué", (mh.data.events as Any[]).some((e) => /a appliqué la carte type/.test(e.message)));

    console.log("\n7. Connecteur MCP");
    const key = (await call(bob, "POST", "/me/api-keys", { name: "Tpl", canWrite: true })).data.key as string;
    const lt = await mcp(key, "list_templates", {});
    check("list_templates", !lt.isError && lt.text.includes(name), lt.text.slice(0, 200));
    const cp = await mcp(key, "create_project", { name: `MCP ${tag}`, template: name.toUpperCase() });
    const cpId = JSON.parse(cp.text || "{}").id;
    toDelete.projects.push(cpId);
    const cpP = await call(bob, "GET", `/projects/${cpId}`);
    check("create_project avec un modèle (par nom)", !cp.isError && cpP.data.project?.stages?.[0]?.name === "Cadrage", cp.text);
    const cm = await mcp(key, "edit_mind_map", { action: "create_map", title: `MCP carte ${tag}`, template: `Atelier ${tag}` });
    const cmId = JSON.parse(cm.text || "{}").map_id;
    toDelete.maps.push(cmId);
    check("create_map avec une carte type", !cm.isError && ((await call(bob, "GET", `/mindmaps/${cmId}`)).data.mindmap.nodes as Any[]).length === 3, cm.text);
    check("modèle inconnu : erreur claire", (await mcp(key, "create_project", { name: "x", template: "Nope" })).text.includes("Modèle inconnu"));

    console.log("\n8. Suppression d'un modèle");
    const del = await call(admin, "DELETE", `/projects/${fromP.data.project.id}`);
    check("l'administrateur supprime un modèle", del.status === 200 || del.status === 204, del);
    check("les projets créés depuis restent", (await call(bob, "GET", `/projects/${p.id}`)).status === 200);
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: toDelete.projects.filter(Boolean) } } });
    await prisma.mindMap.deleteMany({ where: { id: { in: toDelete.maps.filter(Boolean) } } });
    await prisma.project.deleteMany({ where: { ownerId: { in: createdUsers } } });
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
