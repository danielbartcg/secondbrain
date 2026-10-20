/**
 * Tests de bout en bout de la personnalisation : description riche des
 * tâches (assainie, ancien texte brut), commentaires riches (assainis,
 * mentions, extraits de la piste d'audit et des notifications), ordre
 * personnel (listes, épingles), icônes (bibliothèque, personnalisées,
 * validation, droits, piste d'audit des cartes), types de projet dans
 * l'arborescence « Prise de notes ».
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:personalization     # http://localhost:3000 (BASE_URL sinon)
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
  const u = await prisma.user.create({ data: { email: `ps-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: u.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "ps-test" } });
  return { id: u.id, token };
}
async function call<T = Any>(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  return { status: res.status, data: (t ? JSON.parse(t) : {}) as T };
}

async function main() {
  console.log(`Personnalisation — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bruno");
  try {
    const p1 = (await call(A, "POST", "/projects", { name: `Zeta ${tag}` })).data.project;
    const p2 = (await call(A, "POST", "/projects", { name: `Alpha ${tag}` })).data.project;
    const p3 = (await call(A, "POST", "/projects", { name: `Mu ${tag}` })).data.project;
    const pB = (await call(B, "POST", "/projects", { name: `Bruno ${tag}` })).data.project;
    await call(A, "POST", `/projects/${p1.id}/members`, { userId: B.id });

    console.log("\n1. Description riche des tâches");
    const t = (await call(A, "POST", `/projects/${p1.id}/tasks`, { name: "Tâche riche", description: "<p><strong>Important</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>" })).data.task;
    const d1 = (await call(A, "GET", `/tasks/${t.id}`)).data.task.description as string;
    check("HTML assaini (gras gardé, script et onerror retirés)", d1.includes("<strong>Important</strong>") && !d1.includes("<script") && !d1.includes("onerror"), d1);
    const t2 = (await call(A, "POST", `/projects/${p1.id}/tasks`, { name: "Texte brut", description: "Ligne 1\nLigne 2\n\nParagraphe" })).data.task;
    check("texte brut converti en paragraphes", (await call(A, "GET", `/tasks/${t2.id}`)).data.task.description === "<p>Ligne 1<br />Ligne 2</p><p>Paragraphe</p>");
    await call(A, "PATCH", `/tasks/${t2.id}`, { description: "<p></p>" });
    check("description vidée", (await call(A, "GET", `/tasks/${t2.id}`)).data.task.description === "");

    console.log("\n2. Commentaires riches et mentions");
    const c = await call(A, "POST", `/tasks/${t.id}/comments`, { body: "<p>Bonjour <strong>@[Bruno Test]</strong> <em>regarde</em></p><script>x</script>" });
    const comment = (c.data.task.comments as Any[])[0];
    check("commentaire HTML assaini, mention résolue", c.status === 201 && /<strong>@\[Bruno Test\]\([A-Za-z0-9_-]+\)<\/strong>/.test(comment.body) && !comment.body.includes("<script"), comment?.body);
    check("mention enregistrée", comment.mentions.length === 1);
    const notif = await prisma.notification.findFirst({ where: { userId: B.id, type: "MENTION" }, orderBy: { createdAt: "desc" } });
    check("notification : extrait en texte « @Nom »", notif?.body === "Bonjour @Bruno Test regarde", notif?.body);
    const hist = ((await call(A, "GET", `/tasks/${t.id}/history`)).data.events as Any[]).find((e) => e.kind === "comment");
    check("piste d'audit : extrait texte, mention structurée", /« Bonjour @\[Bruno Test\]\([^)]+\) regarde »/.test(hist?.message ?? ""), hist?.message);
    check("commentaire vide après assainissement refusé", (await call(A, "POST", `/tasks/${t.id}/comments`, { body: "<p><script>x</script></p>" })).status === 400);
    await prisma.taskComment.create({ data: { taskId: t.id, authorId: A.id, body: "ancien <b>texte</b>\nbrut", mentions: [] } });
    const old = ((await call(A, "GET", `/tasks/${t.id}`)).data.task.comments as Any[]).find((x) => x.body.includes("ancien"));
    check("ancien commentaire texte : échappé et en paragraphe", old?.body === "<p>ancien &lt;b&gt;texte&lt;/b&gt;<br />brut</p>", old?.body);

    console.log("\n3. Ordre personnel");
    check("ordre vide au départ", (await call(A, "GET", "/me/order?kind=PROJECT")).data.ids.length === 0);
    const o = await call(A, "PUT", "/me/order", { kind: "PROJECT", ids: [p2.id, p3.id, p1.id, pB.id] });
    check("ordre enregistré (projet inaccessible ignoré)", JSON.stringify(o.data.ids) === JSON.stringify([p2.id, p3.id, p1.id]), o.data);
    for (const p of [p1, p2, p3]) await call(A, "PUT", "/me/pins", { kind: "PROJECT", id: p.id, pinned: true });
    const pins = (await call(A, "GET", "/me/pins")).data.pins;
    check("épingles du menu dans l'ordre personnel", pins.projects.map((x: Any) => x.id).join() === [p2.id, p3.id, p1.id].join(), pins.projects.map((x: Any) => x.name));
    check("ordre propre à chacun", (await call(B, "GET", "/me/order?kind=PROJECT")).data.ids.length === 0);
    check("type d'élément invalide refusé", (await call(A, "PUT", "/me/order", { kind: "TASK", ids: [] })).status === 400);
    const m1 = (await call(A, "POST", "/mindmaps", { title: `Carte ${tag}` })).data.mindmap;
    check("ordre des cartes", (await call(A, "PUT", "/me/order", { kind: "MINDMAP", ids: [m1.id] })).data.ids[0] === m1.id);

    console.log("\n4. Icônes");
    const ic = await call(A, "PATCH", `/projects/${p1.id}`, { icon: "lucide:rocket" });
    check("icône de la bibliothèque sur un projet", ic.status === 200 && ic.data.project.icon === "lucide:rocket");
    check("icône visible dans la liste et les épingles", (await call(A, "GET", "/projects")).data.projects.find((x: Any) => x.id === p1.id)?.icon === "lucide:rocket" && (await call(A, "GET", "/me/pins")).data.pins.projects.find((x: Any) => x.id === p1.id)?.icon === "lucide:rocket");
    check("icône invalide refusée", (await call(A, "PATCH", `/projects/${p1.id}`, { icon: "javascript:alert(1)" })).status === 400);
    check("icône SVG refusée", (await call(A, "PATCH", `/projects/${p1.id}`, { icon: "/media/2026/10/x.svg" })).status === 400);
    const mi = await call(A, "PATCH", `/mindmaps/${m1.id}`, { icon: "/media/2026/10/abc.png" });
    check("icône personnalisée sur une carte", mi.status === 200 && (await call(A, "GET", `/mindmaps/${m1.id}`)).data.mindmap.icon === "/media/2026/10/abc.png", mi.data);
    const mh = ((await call(A, "GET", `/mindmaps/${m1.id}/history`)).data.events as Any[]).find((e) => e.kind === "icon");
    check("piste d'audit de la carte", mh?.message?.includes("a changé l'icône"), mh);
    check("retirer l'icône (null)", (await call(A, "PATCH", `/projects/${p1.id}`, { icon: null })).data.project.icon === null);
    check("projet d'autrui : refusé", [403, 404].includes((await call(A, "PATCH", `/projects/${pB.id}`, { icon: "lucide:star" })).status));
    const ui = await call(A, "POST", "/me/icons", { url: "/media/2026/10/mon-icone.png" });
    check("bibliothèque personnelle : ajout", ui.status === 201 && ui.data.icons.length === 1);
    check("bibliothèque personnelle : SVG refusé", (await call(A, "POST", "/me/icons", { url: "/media/2026/10/x.svg" })).status === 400);
    check("bibliothèque personnelle : propre à chacun", (await call(B, "GET", "/me/icons")).data.icons.length === 0);
    check("suppression par autrui : 404", (await call(B, "DELETE", `/me/icons/${ui.data.icons[0].id}`)).status === 404);
    check("suppression", (await call(A, "DELETE", `/me/icons/${ui.data.icons[0].id}`)).data.icons.length === 0);

    console.log("\n5. Prise de notes : types de projet");
    const pt = (await call(A, "POST", "/me/project-types", { name: "Client" })).data.projectTypes.types[0];
    await call(A, "PUT", "/me/project-types/assign", { projectId: p1.id, typeId: pt.id });
    const tree = (await call(A, "GET", "/notes/tree?parent=section:projects")).data.children as Any[];
    const mine = tree.filter((x) => x.kind === "ptype" || [p1.id, p2.id, p3.id].includes(x.id));
    check("types d'abord, puis les projets sans type", mine[0]?.kind === "ptype" && mine[0].title === "Client" && !mine.some((x) => x.id === p1.id), tree.map((x: Any) => `${x.kind}:${x.title}`));
    const sub = (await call(A, "GET", `/notes/tree?parent=ptype:${pt.id}`)).data.children as Any[];
    check("projets du type", sub.length === 1 && sub[0].id === p1.id);
    const doc = (await call(A, "GET", `/notes/ptype/${pt.id}`)).data.document;
    check("document du type (non éditable, fil d'Ariane Projets)", doc?.title === "Client" && doc.editable === false && doc.breadcrumb[0]?.ref === "section:projects", doc);
    check("type d'autrui : 404", (await call(B, "GET", `/notes/tree?parent=ptype:${pt.id}`)).status === 404);
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
