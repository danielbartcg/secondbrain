/**
 * Tests de bout en bout de l'export PowerPoint « état des lieux »
 * (GET /api/v1/projects/:id/export-pptx).
 *
 * Usage (serveur lancé) :
 *   npx tsx scripts/pptx-export-test.ts            # http://localhost:3000 (BASE_URL sinon)
 *   SAVE_PPTX=chemin.pptx npx tsx scripts/pptx-export-test.ts   # conserve la présentation de démonstration
 *
 * Crée des comptes jetables directement en base (sessions Bearer), un projet
 * complet par l'API (étapes datées, tâches en retard / à venir / critiques,
 * livrables, risques, réunion), puis vérifie : 200, type MIME, nom de
 * fichier, archive valide (diapositives, graphiques natifs, titres attendus,
 * encadrés à commenter), projet vide (diapositives adaptées), accès (membre,
 * non-membre 404, anonyme 401, projet type 404). Nettoie tout à la fin.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
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

type U = { id: string; token: string; name: string };
const createdUsers: string[] = [];
const projectIds: string[] = [];

async function makeUser(label: string): Promise<U> {
  const email = `pptx-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4) },
  });
  createdUsers.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "pptx-test" } });
  return { id: user.id, token, name: user.name };
}

async function call<T = Record<string, unknown>>(u: U, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, data: data as T };
}

async function download(u: U | null, projectId: string) {
  const t = Date.now();
  const res = await fetch(`${BASE}/projects/${projectId}/export-pptx`, { headers: u ? { Authorization: `Bearer ${u.token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", buf, ms: Date.now() - t };
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** Texte de chaque diapositive (ordre de la présentation). */
async function slideTexts(buf: Buffer): Promise<{ slides: string[]; charts: number; zip: JSZip }> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const slides: string[] = [];
  for (const n of names) {
    const xml = await zip.file(n)!.async("string");
    slides.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decode(m[1])).join(" "));
  }
  const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length;
  return { slides, charts, zip };
}

const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

type ProjectResp = { project: { id: string; stages: { id: string; name: string }[]; members: { id: string; userId: string | null }[] } };
type TaskResp = { task: { id: string } };

async function main() {
  const alice = await makeUser("Alice");
  const bob = await makeUser("Bob");
  const eve = await makeUser("Eve");
  try {
    console.log("Préparation d'un projet complet");
    const name = `Refonte portail ${tag}`;
    const p = await call<ProjectResp>(alice, "POST", "/projects", { name, description: "Refonte du portail client : parcours, back-office et migration des données.", color: "#0E7490", startDate: day(-90), dueDate: day(120) });
    const projectId = p.data.project.id;
    projectIds.push(projectId);
    const m = await call<ProjectResp>(alice, "POST", `/projects/${projectId}/members`, { userId: bob.id });
    const bobMember = m.data.project.members.find((x) => x.userId === bob.id)!;
    const aliceMember = m.data.project.members.find((x) => x.userId === alice.id)!;
    await call(alice, "POST", `/projects/${projectId}/members`, { name: "Claire Externe", role: "Consultante" });
    const stageNames = ["Cadrage", "Conception", "Réalisation", "Recette & déploiement"];
    const stageDates: Array<[number, number]> = [[-90, -60], [-60, -20], [-20, 40], [40, 120]];
    let stages: { id: string; name: string }[] = [];
    for (let i = 0; i < stageNames.length; i++) {
      const r = await call<ProjectResp>(alice, "POST", `/projects/${projectId}/stages`, { name: stageNames[i], startDate: day(stageDates[i][0]), dueDate: day(stageDates[i][1]) });
      stages = r.data.project.stages;
    }
    const [s1, s2, s3, s4] = stages;
    const task = async (stageId: string, body: Record<string, unknown>) => (await call<TaskResp>(alice, "POST", `/stages/${stageId}/tasks`, body)).data.task.id;
    await task(s1.id, { name: "Atelier de lancement", status: "DONE", dueDate: day(-80), assigneeId: aliceMember.id });
    await task(s1.id, { name: "Note de cadrage", status: "CLOSED", dueDate: day(-65), assigneeId: aliceMember.id });
    await task(s2.id, { name: "Maquettes des parcours", status: "IN_PROGRESS", dueDate: day(-25), assigneeId: bobMember.id, priority: "HIGH" });
    const spec = await task(s2.id, { name: "Spécifications d'interface", status: "TODO", dueDate: day(-40), assigneeId: bobMember.id, priority: "CRITICAL" });
    await task(s3.id, { name: "Développement du back-office", status: "IN_PROGRESS", dueDate: day(10), assigneeId: bobMember.id, prerequisiteIds: [spec] });
    await task(s3.id, { name: "Migration des données", status: "TODO", dueDate: day(5), assigneeId: aliceMember.id, priority: "CRITICAL" });
    await task(s4.id, { name: "Plan de recette", status: "TODO", dueDate: day(60) });
    await call(alice, "POST", `/projects/${projectId}/deliverables`, { name: "Dossier de spécifications", stageId: s2.id, status: "IN_PROGRESS", assigneeId: bobMember.id, expectedEnd: day(-15) });
    await call(alice, "POST", `/projects/${projectId}/deliverables`, { name: "Note de cadrage validée", stageId: s1.id, status: "VALIDATED", expectedEnd: day(-60) });
    await call(alice, "POST", `/projects/${projectId}/deliverables`, { name: "Portail en production", stageId: s4.id, status: "PLANNED", expectedEnd: day(20) });
    await call(alice, "POST", `/projects/${projectId}/risks`, { title: "Indisponibilité de l'équipe d'intégration", probability: 4, impact: 5, status: "OPEN", strategy: "MITIGATE", ownerId: bobMember.id });
    await call(alice, "POST", `/projects/${projectId}/risks`, { title: "Qualité des données sources", probability: 3, impact: 3, status: "MONITORING" });
    await call(alice, "POST", `/projects/${projectId}/risks`, { kind: "OPPORTUNITY", title: "Mutualisation avec le portail partenaires", probability: 2, impact: 4, strategy: "ELIMINATE" });
    await call(alice, "POST", `/projects/${projectId}/meetings`, { title: "Comité de pilotage n°1", date: new Date(Date.now() - 14 * 86400_000).toISOString(), participantIds: [aliceMember.id, bobMember.id] });

    console.log("Export du projet complet");
    const r = await download(alice, projectId);
    check("200", r.status === 200, r.status);
    check("type MIME PowerPoint", r.type.startsWith(PPTX_MIME), r.type);
    check("pièce jointe .pptx nommée", /attachment; filename="Refonte-portail-[0-9a-f]+-etat-des-lieux-\d{4}-\d{2}-\d{2}\.pptx"/.test(r.disposition), r.disposition);
    check("archive ZIP (PK)", r.buf.subarray(0, 2).toString() === "PK");
    if (process.env.SAVE_PPTX) writeFileSync(process.env.SAVE_PPTX, r.buf);
    const { slides, charts, zip } = await slideTexts(r.buf);
    console.log(`    ${slides.length} diapositives, ${charts} graphiques, ${Math.round(r.buf.length / 1024)} Ko, ${r.ms} ms`);
    check("présentation 16:9", /cx="12192000" cy="6858000"/.test(await zip.file("ppt/presentation.xml")!.async("string")));
    const all = slides.join("\n");
    for (const title of ["Synthèse", "Avancement par étape", "Planning des étapes", "Points d'attention", "Risques et opportunités", "Livrables", "Réunions et décisions", "Équipe et charge", "Prochaines étapes"])
      check(`diapositive « ${title} »`, slides.some((s) => s.includes(title)));
    check("titre : nom du projet", slides[0].includes(name) && slides[0].includes("ÉTAT DES LIEUX"), slides[0]);
    check("encadrés à commenter sur chaque diapositive de contenu", slides.slice(1).every((s) => s.includes("Cliquez pour commenter")), slides.map((s) => s.includes("Cliquez pour commenter")));
    check("graphiques natifs (≥ 3)", charts >= 3, charts);
    check("tâche en retard listée", /Points d'attention[\s\S]*Spécifications d'interface/.test(all));
    check("retard en jours", slides.some((s) => s.includes("Points d'attention") && /\b40 j\b/.test(s)));
    check("risque et stratégie", all.includes("Indisponibilité de l'équipe d'intégration") && all.includes("Atténuer"));
    check("opportunité et stratégie", all.includes("Mutualisation avec le portail partenaires") && all.includes("Exploiter"));
    check("livrable en retard", slides.some((s) => s.includes("Dossier de spécifications") && s.includes("15 j")));
    check("réunion", all.includes("Comité de pilotage n°1"));
    check("membre externe dans l'équipe", all.includes("Claire Externe"));
    check("échéances à 30 jours", slides.some((s) => s.includes("Prochaines étapes") && s.includes("Migration des données") && s.includes("Portail en production") && !s.includes("Plan de recette")));
    const layouts = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
    check("pied de page : nom du projet et date d'export", layouts.some((x) => x.includes(name) && x.includes("export du")));

    console.log("Accès");
    const asBob = await download(bob, projectId);
    check("membre → 200", asBob.status === 200, asBob.status);
    const asEve = await download(eve, projectId);
    check("non-membre → 404", asEve.status === 404, asEve.status);
    const anon = await download(null, projectId);
    check("anonyme → 401", anon.status === 401, anon.status);
    const tpl = await prisma.project.create({ data: { ownerId: alice.id, name: `Modèle ${tag}`, isTemplate: true } });
    projectIds.push(tpl.id);
    const asTpl = await download(alice, tpl.id);
    check("projet type → 404", asTpl.status === 404, asTpl.status);

    console.log("Projet vide");
    const e = await call<ProjectResp>(alice, "POST", "/projects", { name: `Projet vide ${tag}` });
    projectIds.push(e.data.project.id);
    const empty = await download(alice, e.data.project.id);
    check("200", empty.status === 200, empty.status);
    const et = (await slideTexts(empty.buf)).slides.join("\n");
    check("états vides explicites", ["Aucun livrable déclaré.", "Aucun risque ni opportunité déclaré.", "Aucune réunion enregistrée.", "Aucune tâche en retard.", "Aucune étape définie"].every((x) => et.includes(x)), et.slice(0, 600));
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
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
