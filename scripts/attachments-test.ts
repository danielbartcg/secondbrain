/**
 * Tests de bout en bout des pièces jointes : documents HTML (projet), pièces
 * jointes des commentaires de tâche et des nœuds de carte (ajout, liste,
 * téléchargement sécurisé, droits, piste d'audit, retrait, nettoyage des
 * fichiers).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:attachments         # http://localhost:3000 (BASE_URL sinon)
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/api/v1";
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "documents");
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
type U = { id: string; token: string };
const users: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string): Promise<U> {
  const u = await prisma.user.create({ data: { email: `at-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: u.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "at-test" } });
  return { id: u.id, token };
}
async function call<T = Any>(u: U | null, method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  let data: Any = {};
  try {
    data = t ? JSON.parse(t) : {};
  } catch {
    data = { raw: t };
  }
  return { status: res.status, data };
}
async function upload(u: U, p: string, name: string, type: string, content: string) {
  const form = new FormData();
  form.append("file", new File([content], name, { type }));
  const res = await fetch(BASE + p, { method: "POST", headers: { Authorization: `Bearer ${u.token}` }, body: form });
  const t = await res.text();
  return { status: res.status, data: (t ? JSON.parse(t) : {}) as Any };
}
async function download(u: U, url: string) {
  const res = await fetch(BASE.replace(/\/api\/v1$/, "") + url, { headers: { Authorization: `Bearer ${u.token}` } });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function main() {
  console.log(`Pièces jointes — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bruno");
  const C = await makeUser("Chloe");
  try {
    const p = (await call(A, "POST", "/projects", { name: `PJ ${tag}` })).data.project;
    await call(A, "POST", `/projects/${p.id}/members`, { userId: B.id });
    const HTML = "<html><body><h1>Rapport</h1><script>alert(1)</script></body></html>";

    console.log("\n1. Documents HTML");
    const doc = await upload(A, `/projects/${p.id}/documents`, "rapport.html", "text/html", HTML);
    check("document HTML accepté", doc.status === 201, doc.data);
    const d = (doc.data.project.documents as Any[]).find((x) => x.name.includes("rapport"));
    const dl = await download(A, d.url + "?inline=1");
    check("aperçu HTML : CSP sandbox, nosniff", dl.status === 200 && /sandbox/.test(dl.headers.get("content-security-policy") ?? "") && dl.headers.get("x-content-type-options") === "nosniff" && dl.headers.get("content-type")?.startsWith("text/html"), Object.fromEntries(dl.headers));
    check("SVG toujours refusé", (await upload(A, `/projects/${p.id}/documents`, "x.svg", "image/svg+xml", "<svg/>")).status === 415);

    console.log("\n2. Pièces jointes des commentaires");
    const t = (await call(A, "POST", `/projects/${p.id}/tasks`, { name: "Tâche PJ" })).data.task;
    const comments = (await call(A, "POST", `/tasks/${t.id}/comments`, { body: "<p>Voir le fichier</p>" })).data.task.comments as Any[];
    const cId = comments[0].id;
    const up = await upload(A, `/comments/${cId}/attachments`, "page.html", "text/html", HTML);
    check("pièce jointe HTML sur mon commentaire (201)", up.status === 201 && up.data.attachments.length === 1 && up.data.attachments[0].fileName === "page.html", up.data);
    const att = up.data.attachments[0];
    check("joindre au commentaire d'autrui : 403", (await upload(B, `/comments/${cId}/attachments`, "b.txt", "text/plain", "x")).status === 403);
    check("type interdit : 415", (await upload(A, `/comments/${cId}/attachments`, "x.svg", "image/svg+xml", "<svg/>")).status === 415);
    const listB = await call(B, "GET", `/tasks/${t.id}/attachments`);
    check("membre : liste des pièces jointes", listB.status === 200 && listB.data.attachments.length === 1);
    check("non-membre : 404", (await call(C, "GET", `/tasks/${t.id}/attachments`)).status === 404);
    const dB = await download(B, att.url);
    check("membre : téléchargement (attachment, sandbox)", dB.status === 200 && dB.body.includes("Rapport") && /attachment/.test(dB.headers.get("content-disposition") ?? "") && /sandbox/.test(dB.headers.get("content-security-policy") ?? ""), dB.status);
    check("non-membre : téléchargement 404", (await download(C, att.url)).status === 404);
    const hist = ((await call(A, "GET", `/tasks/${t.id}/history`)).data.events as Any[]).some((e) => e.message.includes("a joint « page.html »"));
    check("piste d'audit de la tâche", hist);
    check("retrait par un autre membre (ni auteur ni propriétaire) : 403", (await call(B, "DELETE", `/attachments/${att.id}`)).status === 403);
    const stored = (await prisma.attachment.findUnique({ where: { id: att.id } }))!.storagePath;
    check("fichier présent sur disque", fs.existsSync(path.join(DATA, stored)));
    const up2 = await upload(A, `/comments/${cId}/attachments`, "note.txt", "text/plain", "hello");
    const second = up2.data.attachments.find((x: Any) => x.fileName === "note.txt");
    const del = await call(A, "DELETE", `/attachments/${second.id}`);
    check("retrait par l'auteur", del.status === 200 && del.data.attachments.length === 1);
    await call(A, "DELETE", `/comments/${cId}`);
    check("commentaire supprimé : pièces jointes et fichiers effacés", (await prisma.attachment.count({ where: { commentId: cId } })) === 0 && !fs.existsSync(path.join(DATA, stored)));

    console.log("\n3. Pièces jointes des nœuds");
    const m = (await call(A, "POST", "/mindmaps", { title: `Carte PJ ${tag}` })).data.mindmap;
    const node = (await call(A, "POST", `/mindmaps/${m.id}/nodes`, { parentId: m.rootId, title: "Nœud PJ" })).data;
    const nodeId = node.node?.id ?? node.mindmap?.nodes?.find((n: Any) => n.title === "Nœud PJ")?.id;
    const nu = await upload(A, `/mindmaps/${m.id}/nodes/${nodeId}/attachments`, "spec.pdf", "application/pdf", "%PDF-1.4 test");
    check("pièce jointe sur un nœud (201)", nu.status === 201 && nu.data.attachments[0]?.fileName === "spec.pdf", nu.data);
    await call(A, "POST", `/mindmaps/${m.id}/shares`, { userId: B.id, permission: "READ" });
    check("partage en lecture : liste visible", (await call(B, "GET", `/mindmaps/${m.id}/nodes/${nodeId}/attachments`)).data.attachments?.length === 1);
    check("partage en lecture : ajout refusé", [403, 404].includes((await upload(B, `/mindmaps/${m.id}/nodes/${nodeId}/attachments`, "b.txt", "text/plain", "x")).status));
    check("partage en lecture : retrait refusé", (await call(B, "DELETE", `/attachments/${nu.data.attachments[0].id}`)).status === 403);
    check("non partagé : 404", (await call(C, "GET", `/mindmaps/${m.id}/nodes/${nodeId}/attachments`)).status === 404);
    const mh = ((await call(A, "GET", `/mindmaps/${m.id}/history`)).data.events as Any[]).some((e) => e.kind === "node_attachment");
    check("piste d'audit de la carte", mh);
    await call(A, "DELETE", `/mindmaps/${m.id}`);
    check("carte supprimée : dossier des pièces jointes effacé", !fs.existsSync(path.join(DATA, `map_${m.id}`)));
  } finally {
    await prisma.project.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.mindMap.deleteMany({ where: { ownerId: { in: users } } });
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
