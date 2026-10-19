/**
 * Tests de bout en bout des champs personnalisés des projets
 * (/api/v1/admin/custom-fields, /api/v1/custom-fields, PATCH /projects/:id
 * `customFields`, synchro, outils MCP).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:custom-fields       # http://localhost:3000 (BASE_URL sinon)
 *
 * Comptes jetables créés en base ; les champs créés par le test sont supprimés
 * à la fin (les champs existants ne sont pas touchés).
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
    data: { email: `cf-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4), role: admin ? "ADMIN" : "USER" },
  });
  createdUsers.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "cf-test" } });
  return { id: user.id, token };
}
async function call<T = Any>(u: U, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as T };
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
  console.log(`Champs personnalisés — ${ORIGIN}`);
  const admin = await makeUser("admin", true);
  const bob = await makeUser("bob");
  const fieldIds: string[] = [];
  let pid = "";
  try {
    console.log("\n1. Administration");
    const label = `Client ${tag}`;
    const c1 = await call(admin, "POST", "/admin/custom-fields", { label, type: "LIST", options: [{ label: "ACME" }, { label: "Globex" }] });
    const client = (c1.data.fields as Any[]).find((f) => f.label === label);
    check("création d'une liste (201)", c1.status === 201 && client?.type === "LIST" && client.options.length === 2, c1.data);
    fieldIds.push(client.id);
    const c2 = await call(admin, "POST", "/admin/custom-fields", { label: `Code ${tag}`, type: "TEXT" });
    const code = (c2.data.fields as Any[]).find((f) => f.label === `Code ${tag}`);
    fieldIds.push(code.id);
    check("création d'un texte libre", c2.status === 201 && code?.type === "TEXT");
    check("valeurs en double refusées", (await call(admin, "POST", "/admin/custom-fields", { label: "Doublon", type: "LIST", options: [{ label: "A" }, { label: "a" }] })).status === 400);
    check("non-administrateur : création refusée (403)", (await call(bob, "POST", "/admin/custom-fields", { label: "Pirate", type: "TEXT" })).status === 403);
    check("non-administrateur : liste d'administration refusée", (await call(bob, "GET", "/admin/custom-fields")).status === 403);
    const pub = await call(bob, "GET", "/custom-fields");
    check("tout utilisateur lit les définitions actives", pub.status === 200 && (pub.data.fields as Any[]).some((f) => f.id === client.id));

    console.log("\n2. Valeurs dans un projet");
    const created = await call(bob, "POST", "/projects", { name: `Projet CF ${tag}`, customFields: { [client.id]: "ACME" } });
    pid = created.data.project.id;
    const acme = client.options.find((o: Any) => o.label === "ACME").id;
    check("création avec une valeur de liste (par libellé → identifiant)", created.data.project.customFields[client.id] === acme, created.data.project.customFields);
    const up = await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [code.id]: "  PRJ-42  " } });
    check("texte libre ajouté, liste conservée (fusion)", up.data.project.customFields[code.id] === "PRJ-42" && up.data.project.customFields[client.id] === acme, up.data.project.customFields);
    check("valeur hors liste refusée (400, message clair)", /n'est pas une valeur/.test((await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [client.id]: "Initech" } })).data.error?.message ?? ""));
    check("champ inconnu refusé", (await call(bob, "PATCH", `/projects/${pid}`, { customFields: { inconnu: "x" } })).status === 400);
    check("texte trop long refusé", (await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [code.id]: "x".repeat(501) } })).status === 400);
    const list = await call(bob, "GET", "/projects");
    check("liste des projets : valeurs présentes", (list.data.projects as Any[]).find((p) => p.id === pid)?.customFields[code.id] === "PRJ-42");
    const pullRes = await fetch(`${BASE}/sync/pull?project=${pid}`, { headers: { Authorization: `Bearer ${bob.token}`, "X-Sync-Protocol": "2" } });
    const pull = { status: pullRes.status, data: (await pullRes.json()) as Any };
    check("synchro : valeurs dans la ligne Project", (pull.data.changes as Any[] | undefined)?.some((c) => c.entity === "Project" && c.data?.customFields?.[code.id] === "PRJ-42"), pull.status);

    console.log("\n3. Gestion des valeurs");
    const renamed = await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { options: client.options.map((o: Any) => (o.id === acme ? { id: o.id, label: "ACME Corp" } : o)) });
    check("renommer une valeur : même identifiant", (renamed.data.fields as Any[]).find((f) => f.id === client.id).options.some((o: Any) => o.id === acme && o.label === "ACME Corp"));
    const usage = await call(admin, "GET", "/admin/custom-fields");
    check("usage : projets renseignés", usage.data.usage[client.id] === 1 && usage.data.usage[code.id] === 1, usage.data.usage);
    await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { options: [{ label: "Globex" }, { label: "Initech" }] });
    const afterRemove = await call(bob, "GET", `/projects/${pid}`);
    check("valeur retirée de la liste : effacée du projet", !(client.id in afterRemove.data.project.customFields) && afterRemove.data.project.customFields[code.id] === "PRJ-42", afterRemove.data.project.customFields);
    await call(admin, "PATCH", `/admin/custom-fields/${code.id}`, { order: 0 });
    const ordered = (await call(admin, "GET", "/admin/custom-fields")).data.fields as Any[];
    check("réordonner", ordered[0].id === code.id, ordered.map((f) => f.label));
    const labels = (r: Any) => ((r.data.fields as Any[]).find((f) => f.id === client.id).options as Any[]).map((o) => o.label).join("|");
    check("tri manuel par défaut", (ordered.find((f) => f.id === client.id) as Any).optionSort === "MANUAL");
    const cur = (ordered.find((f) => f.id === client.id) as Any).options as Any[];
    const asc = await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { optionSort: "ASC" });
    check("tri forcé A → Z : valeurs rangées", asc.status === 200 && labels(asc) === "Globex|Initech", labels(asc));
    const added = await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { options: [...cur, { label: "Zeta" }, { label: "alpha" }, { label: "Beta 10" }, { label: "Beta 9" }] });
    check("tri forcé : nouvelles valeurs rangées (casse, nombres)", labels(added) === "alpha|Beta 9|Beta 10|Globex|Initech|Zeta", labels(added));
    const desc = await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { optionSort: "DESC" });
    check("tri forcé Z → A", labels(desc) === "Zeta|Initech|Globex|Beta 10|Beta 9|alpha", labels(desc));
    const descOpts = (desc.data.fields as Any[]).find((f) => f.id === client.id).options as Any[];
    const manual = await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { optionSort: "MANUAL", options: [descOpts[2], ...descOpts.filter((_, i) => i !== 2)] });
    check("glisser-déposer : ordre manuel conservé", labels(manual) === "Globex|Zeta|Initech|Beta 10|Beta 9|alpha" && (manual.data.fields as Any[]).find((f) => f.id === client.id).optionSort === "MANUAL", labels(manual));
    check("identifiants conservés au tri", descOpts.every((o) => ((manual.data.fields as Any[]).find((f) => f.id === client.id).options as Any[]).some((x) => x.id === o.id)));
    check("tri sur un texte libre refusé", (await call(admin, "PATCH", `/admin/custom-fields/${code.id}`, { optionSort: "ASC" })).status === 400);
    check("tri invalide refusé", (await call(admin, "PATCH", `/admin/custom-fields/${client.id}`, { optionSort: "RANDOM" })).status === 400);
    const globex = descOpts[2].id;
    await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [client.id]: globex } });
    const u2 = await call(admin, "GET", "/admin/custom-fields");
    check("usage par valeur", u2.data.usage[`${client.id}/${globex}`] === 1 && u2.data.usage[client.id] === 1, u2.data.usage);
    check("ordre public = ordre administré", ((await call(bob, "GET", "/custom-fields")).data.fields as Any[]).find((f) => f.id === client.id).options.map((o: Any) => o.label).join("|") === "Globex|Zeta|Initech|Beta 10|Beta 9|alpha");

    console.log("\n4. Archivage et suppression");
    await call(admin, "PATCH", `/admin/custom-fields/${code.id}`, { active: false });
    check("archivé : masqué des définitions publiques", !((await call(bob, "GET", "/custom-fields")).data.fields as Any[]).some((f) => f.id === code.id));
    check("archivé : valeur conservée", (await call(bob, "GET", `/projects/${pid}`)).data.project.customFields[code.id] === "PRJ-42");
    check("archivé : nouvelle valeur refusée", (await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [code.id]: "PRJ-43" } })).status === 400);
    check("archivé : vider reste possible", !(code.id in (await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [code.id]: null } })).data.project.customFields));
    await call(admin, "PATCH", `/admin/custom-fields/${code.id}`, { active: true });
    await call(bob, "PATCH", `/projects/${pid}`, { customFields: { [code.id]: "PRJ-44" } });
    const del = await call(admin, "DELETE", `/admin/custom-fields/${code.id}`);
    check("suppression : champ retiré", del.status === 200 && !(del.data.fields as Any[]).some((f) => f.id === code.id));
    check("suppression : valeur effacée des projets", !(code.id in (await call(bob, "GET", `/projects/${pid}`)).data.project.customFields));
    fieldIds.splice(fieldIds.indexOf(code.id), 1);

    console.log("\n5. Connecteur MCP");
    const key = (await call(bob, "POST", "/me/api-keys", { name: "CF", canWrite: true })).data.key as string;
    const lf = await mcp(key, "list_custom_fields", {});
    check("list_custom_fields", !lf.isError && lf.text.includes(label) && lf.text.includes("Initech"), lf.text.slice(0, 200));
    const upd = await mcp(key, "update_project", { project_id: pid, custom_fields: { [label]: "Initech" } });
    const after = await call(bob, "GET", `/projects/${pid}`);
    const initech = ((await call(bob, "GET", "/custom-fields")).data.fields as Any[]).find((f) => f.id === client.id).options.find((o: Any) => o.label === "Initech").id;
    check("update_project : champ par libellé, valeur par libellé", !upd.isError && after.data.project.customFields[client.id] === initech, upd.text);
    const gp = await mcp(key, "get_project", { project_id: pid });
    check("get_project : champs lisibles (libellé → valeur)", JSON.parse(gp.text).customFields?.[label] === "Initech", gp.text.slice(0, 200));
    const lp = await mcp(key, "list_projects", { custom_field: `${label}=initech` });
    check("list_projects : filtre « Libellé=valeur »", JSON.parse(lp.text).some((p: Any) => p.id === pid), lp.text.slice(0, 200));
    const bad = await mcp(key, "update_project", { project_id: pid, custom_fields: { Inexistant: "x" } });
    check("update_project : champ inconnu → erreur claire", bad.isError && /inconnu/.test(bad.text), bad.text);
  } finally {
    if (pid) await prisma.project.deleteMany({ where: { id: pid } });
    await prisma.customField.deleteMany({ where: { id: { in: fieldIds } } });
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
