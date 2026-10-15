/**
 * Tests de bout en bout de la gestion des risques et opportunités
 * (/api/v1/projects/:id/risks, /api/v1/risks/:riskId…).
 *
 * Usage (serveur de dev lancé) :
 *   npx tsx scripts/risks-test.ts            # http://localhost:3000 (BASE_URL sinon)
 *
 * Crée des comptes jetables directement en base (sessions Bearer), un projet
 * avec des tâches, puis vérifie : CRUD, criticité / niveau, liens de tâches
 * (même projet uniquement), accès (non-membre, membre, administrateur en
 * lecture seule), cascade à la suppression d'une tâche, piste d'audit.
 * Nettoie tout à la fin.
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
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 800));
  }
}
const tag = randomBytes(4).toString("hex");

type U = { id: string; email: string; token: string; name: string };
const createdUsers: string[] = [];

async function makeUser(label: string, opts: { admin?: boolean } = {}): Promise<U> {
  const email = `risk-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4), role: opts.admin ? "ADMIN" : "USER" },
  });
  createdUsers.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "risks-test" } });
  return { id: user.id, email, token, name: user.name };
}

async function call<T = Record<string, unknown>>(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
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

type Risk = {
  id: string;
  kind: string;
  title: string;
  probability: number;
  impact: number;
  score: number;
  level: string;
  levelLabel: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  taskIds: string[];
  tasks: { id: string; name: string; status: string }[];
  order: number;
};
type RisksResp = { risks: Risk[] };
type ProjectResp = { project: { id: string; members: { id: string; userId: string | null }[] } };
type TaskResp = { task: { id: string } };

async function main() {
  const alice = await makeUser("Alice");
  const bob = await makeUser("Bob");
  const eve = await makeUser("Eve");
  const admin = await makeUser("Admin", { admin: true });
  const projectIds: string[] = [];

  try {
    console.log("Projet et tâches");
    const p = await call<ProjectResp>(alice, "POST", "/projects", { name: `Projet risques ${tag}` });
    check("création du projet", p.status === 201, p);
    const projectId = p.data.project.id;
    projectIds.push(projectId);
    const m = await call<ProjectResp>(alice, "POST", `/projects/${projectId}/members`, { userId: bob.id });
    check("ajout de Bob comme membre", m.status === 201, m);
    const bobMember = m.data.project.members.find((x) => x.userId === bob.id);
    check("fiche membre de Bob", !!bobMember);
    const t1 = await call<TaskResp>(alice, "POST", `/projects/${projectId}/tasks`, { name: "Commander le matériel" });
    const t2 = await call<TaskResp>(alice, "POST", `/projects/${projectId}/tasks`, { name: "Recetter la livraison" });
    check("création des tâches", t1.status === 201 && t2.status === 201, [t1, t2]);
    const task1 = t1.data.task.id;
    const task2 = t2.data.task.id;

    const other = await call<ProjectResp>(eve, "POST", "/projects", { name: `Autre projet ${tag}` });
    projectIds.push(other.data.project.id);
    const foreign = await call<TaskResp>(eve, "POST", `/projects/${other.data.project.id}/tasks`, { name: "Tâche étrangère" });
    const foreignTask = foreign.data.task.id;

    console.log("Création, criticité, niveau");
    const empty = await call<RisksResp>(alice, "GET", `/projects/${projectId}/risks`);
    check("liste vide", empty.status === 200 && empty.data.risks.length === 0, empty);
    const c1 = await call<RisksResp>(alice, "POST", `/projects/${projectId}/risks`, { title: "Retard fournisseur", probability: 4, impact: 4, category: "Fournisseur" });
    check("création d'un risque (201)", c1.status === 201 && c1.data.risks.length === 1, c1);
    const r1 = c1.data.risks[0];
    check("score 16 → critique", r1.score === 16 && r1.level === "critical" && r1.levelLabel === "Critique", r1);
    check("statut par défaut OPEN", r1.status === "OPEN" && r1.kind === "RISK");
    const c2 = await call<RisksResp>(alice, "POST", `/projects/${projectId}/risks`, { kind: "OPPORTUNITY", title: "Subvention régionale", probability: 3, impact: 3 });
    const o1 = c2.data.risks.find((r) => r.kind === "OPPORTUNITY")!;
    check("création d'une opportunité", c2.status === 201 && !!o1, c2);
    check("opportunité 9 → moyenne", o1.score === 9 && o1.level === "medium" && o1.levelLabel === "Moyenne", o1);
    const c3 = await call<RisksResp>(alice, "POST", `/projects/${projectId}/risks`, { title: "Petit risque", probability: 1, impact: 2 });
    const r3 = c3.data.risks.find((r) => r.title === "Petit risque")!;
    check("score 2 → faible", r3.score === 2 && r3.level === "low" && r3.levelLabel === "Faible", r3);
    check("ordre de déclaration", c3.data.risks.map((r) => r.title).join("|") === "Retard fournisseur|Subvention régionale|Petit risque", c3.data.risks.map((r) => r.title));

    console.log("Validation");
    const bad1 = await call(alice, "POST", `/projects/${projectId}/risks`, { title: "", probability: 3, impact: 3 });
    check("titre vide → 400", bad1.status === 400, bad1);
    const bad2 = await call(alice, "POST", `/projects/${projectId}/risks`, { title: "X", probability: 6 });
    check("probabilité 6 → 400", bad2.status === 400, bad2);
    const bad3 = await call(alice, "PATCH", `/risks/${r1.id}`, { dueDate: "15/10/2026" });
    check("date mal formée → 400", bad3.status === 400, bad3);
    const bad4 = await call(alice, "PATCH", `/risks/${r1.id}`, { ownerId: "inexistant" });
    check("responsable hors projet → 400", bad4.status === 400, bad4);

    console.log("Modification");
    const u1 = await call<RisksResp>(alice, "PATCH", `/risks/${r1.id}`, { impact: 3, status: "MONITORING", ownerId: bobMember!.id, dueDate: "2026-12-01", response: "Second fournisseur" });
    const r1b = u1.data.risks.find((r) => r.id === r1.id)!;
    check("PATCH → 200", u1.status === 200, u1);
    check("score recalculé 12 → élevé", r1b.score === 12 && r1b.level === "high" && r1b.levelLabel === "Élevé", r1b);
    check("responsable et échéance", r1b.ownerId === bobMember!.id && r1b.ownerName === bob.name && r1b.dueDate === "2026-12-01", r1b);
    const u2 = await call<RisksResp>(alice, "PATCH", `/risks/${r1.id}`, { dueDate: null });
    check("échéance effacée", u2.data.risks.find((r) => r.id === r1.id)?.dueDate === null);

    console.log("Liens de tâches");
    const l1 = await call<RisksResp>(alice, "PUT", `/risks/${r1.id}/tasks`, { taskIds: [task1, task2] });
    const linked = l1.data.risks.find((r) => r.id === r1.id)!;
    check("liaison de deux tâches", l1.status === 200 && linked.taskIds.length === 2 && linked.tasks.every((t) => t.name && t.status), l1);
    const l2 = await call(alice, "PUT", `/risks/${r1.id}/tasks`, { taskIds: [task1, foreignTask] });
    check("tâche d'un autre projet → 400", l2.status === 400, l2);
    const after400 = await call<RisksResp>(alice, "GET", `/projects/${projectId}/risks`);
    check("liens inchangés après refus", after400.data.risks.find((r) => r.id === r1.id)?.taskIds.length === 2);
    const ev = await prisma.taskEvent.findMany({ where: { taskId: task1, kind: "risk" } });
    check("événement d'audit sur la tâche", ev.length === 1 && ev[0].message.includes("a lié la tâche au risque « Retard fournisseur »") && ev[0].actorId === alice.id, ev);
    const l3 = await call<RisksResp>(alice, "PUT", `/risks/${o1.id}/tasks`, { taskIds: [task1] });
    check("liaison à l'opportunité", l3.data.risks.find((r) => r.id === o1.id)?.taskIds[0] === task1);
    const l4 = await call<RisksResp>(alice, "PUT", `/risks/${o1.id}/tasks`, { taskIds: [] });
    check("retrait du lien", l4.data.risks.find((r) => r.id === o1.id)?.taskIds.length === 0);
    const ev2 = await prisma.taskEvent.findMany({ where: { taskId: task1, kind: "risk" }, orderBy: { createdAt: "asc" } });
    check("audit du retrait (opportunité)", ev2.some((e) => e.message.includes("a retiré le lien avec l'opportunité « Subvention régionale »")), ev2.map((e) => e.message));

    console.log("Accès");
    const eveList = await call(eve, "GET", `/projects/${projectId}/risks`);
    check("non-membre : lecture → 404", eveList.status === 404, eveList);
    const evePatch = await call(eve, "PATCH", `/risks/${r1.id}`, { title: "Piraté" });
    check("non-membre : modification → 404", evePatch.status === 404, evePatch);
    const eveDel = await call(eve, "DELETE", `/risks/${r1.id}`);
    check("non-membre : suppression → 404", eveDel.status === 404, eveDel);
    const eveLink = await call(eve, "PUT", `/risks/${r1.id}/tasks`, { taskIds: [] });
    check("non-membre : liens → 404", eveLink.status === 404, eveLink);
    const eveCreate = await call(eve, "POST", `/projects/${projectId}/risks`, { title: "Intrus" });
    check("non-membre : création → 404", eveCreate.status === 404, eveCreate);
    const anon = await call(null, "GET", `/projects/${projectId}/risks`);
    check("anonyme → 401", anon.status === 401, anon);
    const bobList = await call<RisksResp>(bob, "GET", `/projects/${projectId}/risks`);
    check("membre : lecture", bobList.status === 200 && bobList.data.risks.length === 3, bobList);
    const bobPatch = await call<RisksResp>(bob, "PATCH", `/risks/${r3.id}`, { status: "CLOSED" });
    check("membre : modification", bobPatch.status === 200 && bobPatch.data.risks.find((r) => r.id === r3.id)?.status === "CLOSED", bobPatch);
    const adminList = await call<RisksResp>(admin, "GET", `/projects/${projectId}/risks`);
    check("administrateur : consultation", adminList.status === 200 && adminList.data.risks.length === 3, adminList);
    const adminPatch = await call(admin, "PATCH", `/risks/${r1.id}`, { title: "Admin" });
    check("administrateur : pas d'écriture → 404", adminPatch.status === 404, adminPatch);

    console.log("Cascade et suppression");
    const del = await call(alice, "DELETE", `/tasks/${task2}`);
    check("suppression de la tâche", del.status === 200, del);
    const afterDel = await call<RisksResp>(alice, "GET", `/projects/${projectId}/risks`);
    check("le lien disparaît avec la tâche", JSON.stringify(afterDel.data.risks.find((r) => r.id === r1.id)?.taskIds) === JSON.stringify([task1]), afterDel.data.risks);
    const rdel = await call<RisksResp>(alice, "DELETE", `/risks/${r1.id}`);
    check("suppression du risque", rdel.status === 200 && rdel.data.risks.length === 2 && !rdel.data.risks.some((r) => r.id === r1.id), rdel);
    check("liens supprimés en cascade", (await prisma.riskTask.count({ where: { riskId: r1.id } })) === 0);
    const ev3 = await prisma.taskEvent.findMany({ where: { taskId: task1, kind: "risk" } });
    check("audit de la suppression", ev3.some((e) => e.message.includes("a supprimé le risque « Retard fournisseur »")), ev3.map((e) => e.message));
    const gone = await call(alice, "PATCH", `/risks/${r1.id}`, { title: "Fantôme" });
    check("risque supprimé → 404", gone.status === 404, gone);
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
