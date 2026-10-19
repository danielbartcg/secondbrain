/**
 * Tests de bout en bout du journal quotidien et de l'historique des risques
 * (voyage dans le temps) : saisie par bloc (remplacer, ajouter, effacer),
 * jours futurs refusés, activité calculée depuis les pistes d'audit,
 * calendrier, rapport d'un bloc, préférences (blocs affichés), confidentialité,
 * connecteur MCP (get_journal, write_journal, query_objects) ; risques et
 * opportunités à une date (instantanés `RiskSnapshot`).
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:journal             # http://localhost:3000 (BASE_URL sinon)
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
type U = { id: string; token: string };
const users: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function makeUser(label: string): Promise<U> {
  const u = await prisma.user.create({ data: { email: `jr-${label}-${tag}@test.local`, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: u.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "jr-test" } });
  return { id: u.id, token };
}
async function call<T = Any>(u: U | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  return { status: res.status, data: (t ? JSON.parse(t) : {}) as T };
}
async function tool(key: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const d = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  const text = d.result?.content?.[0]?.text ?? d.error?.message ?? "";
  let json: Any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* message d'erreur */
  }
  return { isError: !!d.result?.isError || !!d.error, text, json };
}
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function main() {
  console.log(`Journal quotidien — ${BASE}`);
  const A = await makeUser("Alice");
  const B = await makeUser("Bruno");
  const today = parisToday();
  const yesterday = shift(today, -1);
  const tenAgo = shift(today, -10);
  try {
    console.log("\n1. Saisie par bloc");
    const empty = await call(A, "GET", `/journal/days/${today}`);
    check("journée vide, 8 blocs activés par défaut", empty.status === 200 && empty.data.journal.entries.length === 0 && empty.data.journal.blocks.length === 8, empty.data);
    const w1 = await call(A, "PUT", `/journal/days/${today}/blocks/POSITIVE`, { content: "<p>Belle réunion d'équipe</p><script>alert(1)</script>" });
    check("enregistrement HTML assaini", w1.status === 200 && w1.data.entry.content === "<p>Belle réunion d'équipe</p>", w1.data);
    const w2 = await call(A, "PUT", `/journal/days/${today}/blocks/POSITIVE`, { text: "Soleil à midi", mode: "append" });
    check("ajout à la suite (texte → paragraphe)", w2.data.entry.content === "<p>Belle réunion d'équipe</p><p>Soleil à midi</p>", w2.data.entry?.content);
    await call(A, "PUT", `/journal/days/${yesterday}/blocks/NEGATIVE`, { text: "Trop de mails" });
    await call(A, "PUT", `/journal/days/${tenAgo}/blocks/NEGATIVE`, { text: "Projet en retard" });
    await call(A, "PUT", `/journal/days/${today}/blocks/SUMMARY`, { text: "Journée productive" });
    const day = await call(A, "GET", `/journal/days/${today}`);
    check("journée : deux blocs renseignés avec dates", day.data.journal.entries.length === 2 && day.data.journal.entries.every((e: Any) => e.createdAt && e.updatedAt), day.data.journal.entries);
    const cleared = await call(A, "PUT", `/journal/days/${today}/blocks/SUMMARY`, { content: "<p> </p>" });
    check("contenu vide : saisie supprimée", cleared.status === 200 && cleared.data.entry === null && (await prisma.journalEntry.count({ where: { userId: A.id, block: "SUMMARY" } })) === 0);
    check("jour futur refusé", (await call(A, "PUT", `/journal/days/${shift(today, 5)}/blocks/POSITIVE`, { text: "x" })).status === 400);
    check("bloc Activité non modifiable", (await call(A, "PUT", `/journal/days/${today}/blocks/ACTIVITY`, { text: "x" })).status === 400);
    check("jour invalide refusé", (await call(A, "GET", `/journal/days/2026-02-30`)).status === 400);
    check("sans session : 401", (await call(null, "GET", `/journal/days/${today}`)).status === 401);

    console.log("\n2. Activité (pistes d'audit)");
    const p = (await call(A, "POST", "/projects", { name: `Projet journal ${tag}` })).data.project;
    const t = (await call(A, "POST", `/projects/${p.id}/tasks`, { name: "Rédiger la note de cadrage" })).data.task;
    await call(A, "PATCH", `/tasks/${t.id}`, { status: "IN_PROGRESS" });
    const act = (await call(A, "GET", `/journal/days/${today}`)).data.journal.activity as Any[];
    check("activité du jour : tâche créée et modifiée", act.filter((i) => i.objectId === t.id).length >= 2 && act[0].context === `Projet journal ${tag}`, act.slice(0, 3));
    check("activité d'un autre jour vide", ((await call(A, "GET", `/journal/days/${tenAgo}`)).data.journal.activity as Any[]).length === 0);

    console.log("\n3. Calendrier et rapport");
    const cal = await call(A, "GET", `/journal/calendar?from=${shift(today, -30)}&to=${today}`);
    check("calendrier : jours renseignés", JSON.stringify(cal.data.days) === JSON.stringify([tenAgo, yesterday, today].sort()), cal.data);
    const rep = await call(A, "GET", `/journal/report?block=NEGATIVE&from=${shift(today, -30)}&to=${today}`);
    check("rapport : saisies du bloc, plus récente d'abord", rep.status === 200 && rep.data.report.entries.map((e: Any) => e.day).join() === `${yesterday},${tenAgo}`, rep.data.report?.entries);
    check("rapport : série quotidienne (31 jours, mots)", rep.data.report.series.length === 31 && rep.data.report.series.find((s: Any) => s.day === yesterday).value === 3);
    const repAct = await call(A, "GET", `/journal/report?block=ACTIVITY&from=${shift(today, -7)}&to=${today}`);
    check("rapport Activité : actions par jour", repAct.data.report.activityDays[0]?.day === today && repAct.data.report.activityDays[0].count >= 2, repAct.data.report?.activityDays);
    check("rapport : période inversée refusée", (await call(A, "GET", `/journal/report?block=NEGATIVE&from=${today}&to=${tenAgo}`)).status === 400);
    check("rapport : plus de 366 jours refusé", (await call(A, "GET", `/journal/report?block=NEGATIVE&from=2020-01-01&to=${today}`)).status === 400);

    console.log("\n4. Préférences et confidentialité");
    const pref = await call(A, "PATCH", "/me", { journalBlocks: ["ACTIVITY", "POSITIVE", "REGRETS"] });
    check("blocs activés, ordre canonique", JSON.stringify(pref.data.profile.journalBlocks) === JSON.stringify(["POSITIVE", "REGRETS", "ACTIVITY"]), pref.data.profile?.journalBlocks);
    check("la journée ne liste que les blocs activés", JSON.stringify((await call(A, "GET", `/journal/days/${today}`)).data.journal.blocks) === JSON.stringify(["POSITIVE", "REGRETS", "ACTIVITY"]));
    check("bloc inconnu refusé", (await call(A, "PATCH", "/me", { journalBlocks: ["HUMEUR"] })).status === 400);
    await call(A, "PATCH", "/me", { journalBlocks: ["POSITIVE"] });
    check("Activité désactivée : non calculée", ((await call(A, "GET", `/journal/days/${today}`)).data.journal.activity as Any[]).length === 0);
    const bDay = await call(B, "GET", `/journal/days/${today}`);
    check("une autre personne ne voit pas mon journal", bDay.data.journal.entries.length === 0);
    check("une autre personne ne voit pas mes jours renseignés", ((await call(B, "GET", `/journal/calendar?from=${shift(today, -30)}&to=${today}`)).data.days as Any[]).length === 0);

    console.log("\n5. Connecteur MCP");
    const key = (await call(A, "POST", "/me/api-keys", { name: "JR", canWrite: true })).data.key as string;
    const wr = await tool(key, "write_journal", { block: "pensées positives", text: "Merci à l'équipe pour la démo" });
    check("write_journal : libellé approximatif, ajout du jour", !wr.isError && wr.json?.block === "Pensées positives du jour" && wr.json?.day === today, wr.text);
    const after = (await call(A, "GET", `/journal/days/${today}`)).data.journal.entries.find((e: Any) => e.block === "POSITIVE");
    check("write_journal : ajouté à la suite", /Soleil à midi<\/p><p>Merci à l'équipe pour la démo/.test(after?.content ?? ""), after?.content);
    const wrR = await tool(key, "write_journal", { block: "REGRETS", text: "Pas assez de sport", day: yesterday, mode: "replace" });
    check("write_journal : autre jour, remplacement", !wrR.isError && (await prisma.journalEntry.count({ where: { userId: A.id, block: "REGRETS" } })) === 1, wrR.text);
    const wrBad = await tool(key, "write_journal", { block: "activité", text: "x" });
    check("write_journal : bloc Activité refusé", wrBad.isError && /calculé/.test(wrBad.text), wrBad.text);
    const rd = await tool(key, "get_journal", { block: "pensées négatives", from: shift(today, -14) });
    check("get_journal : un bloc sur 2 semaines", !rd.isError && rd.json.days.length === 2 && rd.json.days[0].day === yesterday && rd.json.days[0].blocks["Pensées négatives"].text === "Trop de mails", rd.json);
    const rdAll = await tool(key, "get_journal", { day: today, with_activity: true });
    check("get_journal : journée complète avec activité", rdAll.json.days[0]?.blocks["Pensées positives du jour"] && rdAll.json.days[0].activity?.some((l: string) => l.includes("Rédiger la note de cadrage")), rdAll.json);
    const q = await tool(key, "query_objects", { entity: "journal_entry", status: "négatives", limit: 1 });
    check("query_objects journal_entry : dernière pensée négative", q.json?.items?.length === 1 && q.json.items[0].day === yesterday && q.json.items[0].createdAt, q.text);
    const keyB = (await call(B, "POST", "/me/api-keys", { name: "JR B", canWrite: false })).data.key as string;
    const rdB = await tool(keyB, "get_journal", { from: shift(today, -30) });
    check("get_journal : strictement personnel", rdB.json?.days?.length === 0, rdB.json);
    const roWrite = await tool(keyB, "write_journal", { block: "SUMMARY", text: "x" });
    check("clé en lecture seule : écriture refusée", roWrite.isError);

    console.log("\n6. Voyage dans le temps : risques à une date");
    const before = new Date();
    await new Promise((r) => setTimeout(r, 50));
    const r1 = (await call(A, "POST", `/projects/${p.id}/risks`, { title: "Retard fournisseur", probability: 2, impact: 2 })).data.risks[0];
    await call(A, "POST", `/projects/${p.id}/risks`, { kind: "OPPORTUNITY", title: "Subvention", probability: 3, impact: 3 });
    await new Promise((r) => setTimeout(r, 50));
    const mid = new Date();
    await new Promise((r) => setTimeout(r, 50));
    await call(A, "PATCH", `/risks/${r1.id}`, { probability: 5, impact: 5, status: "MONITORING" });
    const tmp = (await call(A, "POST", `/projects/${p.id}/risks`, { title: "Risque éphémère", probability: 1, impact: 1 })).data.risks.find((r: Any) => r.title === "Risque éphémère");
    await call(A, "DELETE", `/risks/${tmp.id}`);
    check("instantanés posés par le déclencheur", (await prisma.riskSnapshot.count({ where: { projectId: p.id } })) === 5);
    const atMid = (await call(A, "GET", `/projects/${p.id}/time-travel?at=${mid.toISOString()}`)).data.state;
    const r1Mid = atMid.risks.find((r: Any) => r.id === r1.id);
    check("risque tel qu'il était (criticité 4, ouvert)", r1Mid?.score === 4 && r1Mid.status === "OPEN" && r1Mid.changedSince === true, r1Mid);
    check("opportunité présente à cette date", atMid.risks.some((r: Any) => r.kind === "OPPORTUNITY" && r.title === "Subvention"));
    check("risque créé ensuite absent", !atMid.risks.some((r: Any) => r.title === "Risque éphémère"));
    const now = (await call(A, "GET", `/projects/${p.id}/time-travel?at=${new Date().toISOString()}`)).data.state;
    check("aujourd'hui : criticité 25, en surveillance", now.risks.find((r: Any) => r.id === r1.id)?.score === 25 && now.risks.find((r: Any) => r.id === r1.id)?.status === "MONITORING");
    check("risque supprimé : absent aujourd'hui", !now.risks.some((r: Any) => r.title === "Risque éphémère"));
    const atBefore = (await call(A, "GET", `/projects/${p.id}/time-travel?at=${before.toISOString()}`)).data.state;
    check("avant création : registre vide", atBefore.risks.length === 0, atBefore.risks);
    check("tâches à la date (Gantt) toujours servies", Array.isArray(now.tasks) && now.tasks.some((x: Any) => x.id === t.id));
    check("suppression du projet : instantanés effacés", (await call(A, "DELETE", `/projects/${p.id}`)).status === 200 && (await prisma.riskSnapshot.count({ where: { projectId: p.id } })) === 0);
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
