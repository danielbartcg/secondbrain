/**
 * Tests de bout en bout des requêtes « récentes » du connecteur MCP :
 * query_objects (tous objets, auteur, dates, tri), list_recent_tasks,
 * list_meetings, get_meeting — comme les poserait Claude Desktop.
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:mcp-query           # http://localhost:3000 (BASE_URL sinon)
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
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 1200));
  }
}
const tag = randomBytes(4).toString("hex");
type U = { id: string; token: string; name: string };
const users: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string): Promise<U> {
  const u = await prisma.user.create({ data: { email: `mq-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: u.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "mq-test" } });
  return { id: u.id, token, name: u.name };
}
async function call<T = Any>(u: U, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  return { status: res.status, data: (t ? JSON.parse(t) : {}) as T };
}
async function tool(key: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const d = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  const text = d.result?.content?.[0]?.text ?? "";
  let json: Any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* message d'erreur */
  }
  return { isError: !!d.result?.isError, text, json };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Requêtes récentes MCP — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bruno");
  const C = await makeUser("Chloe");
  try {
    const p = (await call(A, "POST", "/projects", { name: `Projet MQ ${tag}` })).data.project;
    await call(A, "POST", `/projects/${p.id}/members`, { userId: B.id });
    const members = (await call(A, "GET", `/projects/${p.id}`)).data.project.members as Any[];
    const bMember = members.find((m) => m.userId === B.id).id;
    // Réunions : 4 par Alice, 1 par Bruno, créées dans l'ordre.
    const titles: string[] = [];
    for (let i = 1; i <= 4; i++) {
      titles.push(`CR Alice ${i}`);
      await call(A, "POST", `/projects/${p.id}/meetings`, { title: `CR Alice ${i}`, date: new Date(Date.now() - (10 - i) * 86400_000).toISOString(), minutes: `<p>Compte-rendu numéro ${i} : décisions importantes sur le lot ${i}.</p>` });
      await pause(30);
    }
    await call(B, "POST", `/projects/${p.id}/meetings`, { title: "CR Bruno", date: new Date().toISOString(), minutes: "<p>Point de Bruno</p>", approverIds: [] });
    // Tâches et commentaires.
    const tasks: string[] = [];
    for (let i = 1; i <= 12; i++) {
      tasks.push((await call(i % 3 === 0 ? B : A, "POST", `/projects/${p.id}/tasks`, { name: `Tâche ${i}`, assigneeId: i % 2 ? bMember : undefined })).data.task.id);
      await pause(15);
    }
    await call(B, "POST", `/tasks/${tasks[0]}/comments`, { body: "Commentaire de Bruno sur la tâche 1" });
    await call(A, "POST", `/tasks/${tasks[1]}/comments`, { body: "Commentaire d'Alice" });
    await call(A, "PATCH", `/tasks/${tasks[2]}`, { status: "CLOSED" });

    const key = (await call(A, "POST", "/me/api-keys", { name: "MQ", canWrite: false })).data.key as string;

    console.log("\n1. « Mes 3 derniers comptes-rendus »");
    const r1 = await tool(key, "query_objects", { entity: "meeting", author: "me", limit: 3, with_content: true });
    const items = r1.json?.items as Any[];
    check("3 réunions d'Alice, de la plus récente à la plus ancienne", !r1.isError && items?.length === 3 && items.map((m) => m.title).join() === "CR Alice 4,CR Alice 3,CR Alice 2", items?.map((m) => m.title) ?? r1.text);
    check("dates de création et de modification présentes", items?.every((m) => m.createdAt && m.updatedAt));
    check("compte-rendu complet (with_content)", /décisions importantes sur le lot 4/.test(items?.[0]?.minutes ?? ""), items?.[0]);
    check("rédacteur et projet indiqués", items?.[0]?.author === "Alice Test" && items?.[0]?.project?.name === `Projet MQ ${tag}`);
    const r1b = await tool(key, "query_objects", { entity: "meeting", author: "Bruno", limit: 5 });
    check("réunions d'un autre auteur par son nom", r1b.json?.items?.length === 1 && r1b.json.items[0].title === "CR Bruno", r1b.text);

    console.log("\n2. Dernières tâches");
    const r2 = await tool(key, "query_objects", { entity: "task", limit: 10 });
    check("10 dernières tâches créées, la plus récente d'abord", r2.json?.items?.length === 10 && r2.json.items[0].name === "Tâche 12" && r2.json.items[9].name === "Tâche 3", r2.json?.items?.map((t: Any) => t.name));
    const r2b = await tool(key, "query_objects", { entity: "task", author: "me", limit: 50 });
    check("tâches que j'ai créées (8 sur 12)", r2b.json?.items?.length === 8 && r2b.json.items.every((t: Any) => t.createdBy === "Alice Test"), r2b.json?.items?.length);
    const r2c = await tool(key, "query_objects", { entity: "task", assignee: "Bruno", limit: 50 });
    check("tâches dont Bruno est responsable (6)", r2c.json?.items?.length === 6, r2c.json?.items?.length);
    const r2d = await tool(key, "query_objects", { entity: "task", sort: "updated", limit: 1 });
    check("dernière tâche modifiée", r2d.json?.items?.[0]?.name === "Tâche 3" && r2d.json.items[0].status === "CLOSED", r2d.json?.items);
    const r2e = await tool(key, "query_objects", { entity: "task", created_after: "2099-01-01" });
    check("fenêtre de dates future : aucune", r2e.json?.count === 0);
    const r2f = await tool(key, "list_recent_tasks", { limit: 2 });
    check("list_recent_tasks : 2 dernières", Array.isArray(r2f.json) && r2f.json.length === 2 && r2f.json[0].name === "Tâche 12" && r2f.json[0].createdAt, r2f.text.slice(0, 200));
    const r2g = await tool(key, "list_recent_tasks", { sort: "closed", limit: 5 });
    check("list_recent_tasks : dernières clôturées", r2g.json?.length === 1 && r2g.json[0].name === "Tâche 3");

    console.log("\n3. Commentaires, réunions, recherche texte");
    const r3 = await tool(key, "query_objects", { entity: "comment", author: "Bruno" });
    check("commentaires de Bruno avec leur tâche", r3.json?.items?.length === 1 && r3.json.items[0].task.name === "Tâche 1", r3.json);
    const r3b = await tool(key, "list_meetings", { limit: 2 });
    check("list_meetings : 2 plus récentes (par date de réunion) avec compte-rendu", r3b.json?.length === 2 && r3b.json[0].title === "CR Bruno" && /Point de Bruno/.test(r3b.json[0].minutes ?? ""), r3b.text.slice(0, 300));
    const one = r3b.json?.[1]?.id;
    const r3c = await tool(key, "get_meeting", { meeting_id: one });
    check("get_meeting : compte-rendu intégral", !r3c.isError && /Compte-rendu numéro 4/.test(r3c.json?.minutes ?? ""), r3c.text.slice(0, 200));
    const r3d = await tool(key, "query_objects", { entity: "meeting", text: "lot 2" });
    check("recherche texte dans les comptes-rendus", r3d.json?.items?.length === 1 && r3d.json.items[0].title === "CR Alice 2");
    const r3e = await tool(key, "query_objects", { entity: "project", author: "me" });
    check("mes projets avec dates", r3e.json?.items?.some((x: Any) => x.id === p.id && x.createdAt), r3e.json);
    const r3f = await tool(key, "get_task", { task_id: tasks[0] });
    check("get_task : créateur et dates", r3f.json?.createdAt && r3f.json?.createdBy === "Alice Test" && r3f.json?.updatedAt, r3f.json);

    console.log("\n4. Périmètre");
    const keyC = (await call(C, "POST", "/me/api-keys", { name: "MQ C", canWrite: false })).data.key as string;
    const r4 = await tool(keyC, "query_objects", { entity: "meeting", limit: 50 });
    check("une autre personne ne voit pas ces réunions", !r4.json?.items?.some((m: Any) => m.project?.id === p.id), r4.json);
    const r4b = await tool(keyC, "get_meeting", { meeting_id: one });
    check("get_meeting hors périmètre : erreur", r4b.isError);
    const r4c = await tool(keyC, "query_objects", { entity: "task", admin_access: true });
    check("admin_access refusé à un non-administrateur", r4c.isError && /administrateurs/.test(r4c.text), r4c.text);
    const r4d = await tool(key, "query_objects", { entity: "inconnu" });
    check("entité inconnue : erreur claire", r4d.isError, r4d.text);
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
