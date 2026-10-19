/**
 * Tests de bout en bout des types de projet personnels : création (nom
 * unique, borne), renommage, ordre (liste complète exigée), rangement d'un
 * projet (accessible seulement, type à moi seulement), retrait, suppression
 * d'un type (projets sans type), classement propre à chaque utilisateur,
 * nettoyage à la suppression du projet.
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:project-types       # http://localhost:3000 (BASE_URL sinon)
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/api/v1";
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
const users: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string): Promise<U> {
  const u = await prisma.user.create({ data: { email: `pt-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: u.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "pt-test" } });
  return { id: u.id, token };
}
async function call<T = Any>(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  return { status: res.status, data: (t ? JSON.parse(t) : {}) as T };
}

async function main() {
  console.log(`Types de projet — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bruno");
  try {
    const p1 = (await call(A, "POST", "/projects", { name: `Client X ${tag}` })).data.project;
    const p2 = (await call(A, "POST", "/projects", { name: `Interne ${tag}` })).data.project;
    const pB = (await call(B, "POST", "/projects", { name: `Projet de Bruno ${tag}` })).data.project;
    await call(A, "POST", `/projects/${p1.id}/members`, { userId: B.id });

    console.log("\n1. Création, renommage, ordre");
    check("aucun type au départ", (await call(A, "GET", "/me/project-types")).data.projectTypes.types.length === 0);
    const c1 = await call(A, "POST", "/me/project-types", { name: "Client" });
    const c2 = await call(A, "POST", "/me/project-types", { name: "Interne" });
    const c3 = await call(A, "POST", "/me/project-types", { name: "Marketing" });
    const ids = c3.data.projectTypes.types.map((t: Any) => t.id);
    check("création (201), ordre de création", c1.status === 201 && c3.data.projectTypes.types.map((t: Any) => t.name).join() === "Client,Interne,Marketing", c3.data);
    check("nom en double refusé (casse ignorée)", (await call(A, "POST", "/me/project-types", { name: "client" })).status === 400);
    check("nom vide refusé", (await call(A, "POST", "/me/project-types", { name: "  " })).status === 400);
    const ren = await call(A, "PATCH", `/me/project-types/${ids[0]}`, { name: "Projet client" });
    check("renommage", ren.data.projectTypes.types[0].name === "Projet client");
    const ord = await call(A, "PUT", "/me/project-types/order", { ids: [ids[2], ids[0], ids[1]] });
    check("nouvel ordre", ord.data.projectTypes.types.map((t: Any) => t.name).join() === "Marketing,Projet client,Interne", ord.data);
    check("ordre incomplet refusé", (await call(A, "PUT", "/me/project-types/order", { ids: [ids[0]] })).status === 400);
    check("type d'un autre : 404", (await call(B, "PATCH", `/me/project-types/${ids[0]}`, { name: "Piraté" })).status === 404);
    void c2;

    console.log("\n2. Rangement des projets");
    const a1 = await call(A, "PUT", "/me/project-types/assign", { projectId: p1.id, typeId: ids[0] });
    await call(A, "PUT", "/me/project-types/assign", { projectId: p2.id, typeId: ids[1] });
    check("projet rangé", a1.status === 200 && a1.data.projectTypes.assignments[p1.id] === ids[0], a1.data);
    const mv = await call(A, "PUT", "/me/project-types/assign", { projectId: p1.id, typeId: ids[2] });
    check("glisser vers un autre type", mv.data.projectTypes.assignments[p1.id] === ids[2]);
    check("projet non accessible : 404", (await call(A, "PUT", "/me/project-types/assign", { projectId: pB.id, typeId: ids[0] })).status === 404);
    check("type d'un autre utilisateur : 404", (await call(B, "PUT", "/me/project-types/assign", { projectId: p1.id, typeId: ids[0] })).status === 404);
    check("« Sans projet » ne se range pas", (await call(A, "PUT", "/me/project-types/assign", { projectId: "sans-projet", typeId: ids[0] })).status === 404);
    const bTypes = (await call(B, "GET", "/me/project-types")).data.projectTypes;
    check("classement propre à chacun (Bruno, membre, ne voit rien)", bTypes.types.length === 0 && Object.keys(bTypes.assignments).length === 0);
    const bt = (await call(B, "POST", "/me/project-types", { name: "Client" })).data.projectTypes.types[0];
    await call(B, "PUT", "/me/project-types/assign", { projectId: p1.id, typeId: bt.id });
    check("même projet, types différents selon la personne", (await call(A, "GET", "/me/project-types")).data.projectTypes.assignments[p1.id] === ids[2] && (await call(B, "GET", "/me/project-types")).data.projectTypes.assignments[p1.id] === bt.id);
    const un = await call(A, "PUT", "/me/project-types/assign", { projectId: p2.id, typeId: null });
    check("retirer le type", !(p2.id in un.data.projectTypes.assignments));

    console.log("\n3. Suppression et nettoyage");
    const del = await call(A, "DELETE", `/me/project-types/${ids[2]}`);
    check("supprimer un type : ses projets redeviennent sans type", del.status === 200 && !(p1.id in del.data.projectTypes.assignments) && del.data.projectTypes.types.length === 2, del.data);
    await call(A, "DELETE", `/members/${(await call(A, "GET", `/projects/${p1.id}`)).data.project.members.find((m: Any) => m.userId === B.id).id}`);
    check("plus membre : le rangement ne remonte plus", !(p1.id in (await call(B, "GET", "/me/project-types")).data.projectTypes.assignments));
    await call(A, "PUT", "/me/project-types/assign", { projectId: p2.id, typeId: ids[0] });
    await call(A, "DELETE", `/projects/${p2.id}`);
    check("projet supprimé : rattachement effacé", (await prisma.projectTypeLink.count({ where: { projectId: p2.id } })) === 0);
    check("sans session : 401", (await call(null, "GET", "/me/project-types")).status === 401);
  } finally {
    await prisma.project.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
  console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
