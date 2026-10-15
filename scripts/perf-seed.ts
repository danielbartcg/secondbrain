/**
 * Jeu de données volumineux pour les tests de performance (conservé pour
 * réutilisation). Déterministe (graine fixe), idempotent : `--reset` supprime
 * d'abord tout ce qui appartient aux comptes `perf-*@perf.local`.
 *
 * Usage (base locale uniquement) :
 *   npm run perf:seed              # crée le jeu s'il n'existe pas
 *   npm run perf:seed -- --reset   # le recrée
 *   npm run perf:seed -- --drop    # le supprime
 *
 * Volumes (par défaut, ajustables par SCALE=0.2 … 2) :
 *   200 comptes ; perf-000 (« Paula Perf », administratrice) possède 40 projets
 *   de 10 membres, 8 étapes × 4 activités, ~400 tâches chacun (≈ 16 000), plus
 *   un projet géant de 4 000 tâches ; 20 % des tâches commentées (×3) ;
 *   25 cartes mentales de 300 nœuds + une carte géante de 5 000 nœuds ;
 *   60 conversations de 150 messages ; 3 000 notifications.
 *
 * Connexion : perf-000@perf.local / mot de passe `PerfTest!2026` (local).
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const SCALE = Number(process.env.SCALE ?? 1);
const DOMAIN = "@perf.local";
const PASSWORD = "PerfTest!2026";

if (!/@(localhost|127.0.0.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refus : DATABASE_URL ne pointe pas vers une base locale.");
  process.exit(1);
}

// Générateur pseudo-aléatoire déterministe (mulberry32).
let seed = 42;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const n = (x: number) => Math.max(1, Math.round(x * SCALE));
let idc = 0;
const id = (p: string) => `perf${p}${(idc++).toString(36).padStart(7, "0")}`;

const FIRST = ["Paula", "Marc", "Julie", "Hugo", "Inès", "Léo", "Chloé", "Nora", "Yanis", "Emma", "Lucas", "Sarah", "Tom", "Lina", "Adam", "Zoé"];
const LAST = ["Martin", "Bernard", "Dubois", "Durand", "Lefebvre", "Moreau", "Laurent", "Simon", "Michel", "Garcia", "Roux", "Fournier"];
const VERBS = ["Analyser", "Rédiger", "Valider", "Préparer", "Tester", "Déployer", "Concevoir", "Mesurer", "Documenter", "Relire", "Chiffrer", "Planifier"];
const OBJECTS = ["le cahier des charges", "la maquette", "l'API de facturation", "le plan de tests", "la migration", "le tableau de bord", "le contrat", "la recette", "le budget", "la formation", "l'audit", "le lot 2"];
const STATUSES = ["TODO", "IN_PROGRESS", "TODO", "DONE", "CLOSED"] as const;
const PRIOS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

async function batched<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function drop() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: ids } } } } });
  // Les cascades (projets, cartes, tâches…) suivent la suppression des comptes.
  await prisma.project.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.mindMap.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Supprimé : ${ids.length} comptes perf et leurs données.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--drop")) return drop();
  if (args.includes("--reset")) await drop();
  else if (await prisma.user.findUnique({ where: { email: `perf-000${DOMAIN}` } })) {
    console.log("Jeu de données déjà présent (--reset pour le recréer).");
    return;
  }
  const t = Date.now();
  const hash = await bcrypt.hash(PASSWORD, 12);

  // Comptes
  const users = Array.from({ length: n(200) }, (_, i) => {
    const firstName = i === 0 ? "Paula" : pick(FIRST);
    const lastName = i === 0 ? "Perf" : `${pick(LAST)} ${i}`;
    return { id: id("u"), email: `perf-${String(i).padStart(3, "0")}${DOMAIN}`, passwordHash: hash, firstName, lastName, name: `${firstName} ${lastName}`, role: i === 0 ? ("ADMIN" as const) : ("USER" as const) };
  });
  users.forEach((u, i) => i > 0 && i < 30 && Object.assign(u, { managerId: users[0].id }));
  await prisma.user.createMany({ data: users });
  const me = users[0];

  // Projets
  const projects: Prisma.ProjectCreateManyInput[] = [];
  const members: Prisma.ProjectMemberCreateManyInput[] = [];
  const stages: Prisma.StageCreateManyInput[] = [];
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const contributors: Prisma.TaskContributorCreateManyInput[] = [];
  const comments: Prisma.TaskCommentCreateManyInput[] = [];

  function makeProject(name: string, ownerIdx: number, stageCount: number, actPerStage: number, taskCount: number) {
    const pid = id("p");
    projects.push({ id: pid, ownerId: users[ownerIdx].id, name, description: `Projet de charge ${name}`, color: pick(["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed"]), startDate: new Date(T0), dueDate: new Date(T0 + 300 * DAY) });
    const memberIdx = new Set<number>([ownerIdx, 0]);
    while (memberIdx.size < Math.min(10, users.length)) memberIdx.add(Math.floor(rnd() * users.length));
    const mids = [...memberIdx].map((ui) => {
      const mid = id("m");
      members.push({ id: mid, projectId: pid, userId: users[ui].id, name: users[ui].name, email: users[ui].email, role: pick(["Chef de projet", "Développeur", "Analyste", "Testeur"]) });
      return { mid, uid: users[ui].id };
    });
    members.push({ id: id("m"), projectId: pid, name: "Prestataire externe" });
    const slots: { stageId: string; activityId: string | null }[] = [];
    for (let s = 0; s < stageCount; s++) {
      const sid = id("s");
      stages.push({ id: sid, projectId: pid, name: `Étape ${s + 1}`, order: s, startDate: new Date(T0 + s * 30 * DAY), dueDate: new Date(T0 + (s + 1) * 30 * DAY) });
      slots.push({ stageId: sid, activityId: null });
      for (let a = 0; a < actPerStage; a++) {
        const aid = id("a");
        activities.push({ id: aid, stageId: sid, name: `Activité ${s + 1}.${a + 1}`, order: a });
        slots.push({ stageId: sid, activityId: aid });
      }
    }
    const projectTaskIds: string[] = [];
    for (let k = 0; k < taskCount; k++) {
      const slot = slots[k % slots.length];
      const tid = id("t");
      const start = T0 + Math.floor(rnd() * 280) * DAY;
      const status = pick(STATUSES);
      const assignee = pick(mids);
      const prereq = projectTaskIds.length && rnd() < 0.15 ? [projectTaskIds[projectTaskIds.length - 1 - Math.floor(rnd() * Math.min(20, projectTaskIds.length))]] : [];
      tasks.push({
        id: tid, ownerId: users[ownerIdx].id, projectId: pid, stageId: slot.stageId, activityId: slot.activityId, assigneeId: assignee.mid, supervisorId: rnd() < 0.3 ? pick(mids).mid : null,
        name: `${pick(VERBS)} ${pick(OBJECTS)} #${k + 1}`, description: rnd() < 0.3 ? "Description détaillée de la tâche, critères d'acceptation et points d'attention." : "",
        notes: rnd() < 0.1 ? "<p>Notes de travail <strong>riches</strong> avec une liste :</p><ul><li>point A</li><li>point B</li></ul>" : "",
        status, progress: status === "DONE" || status === "CLOSED" ? 100 : Math.floor(rnd() * 90), priority: pick(PRIOS), order: k,
        startDate: new Date(start), dueDate: new Date(start + (2 + Math.floor(rnd() * 20)) * DAY), closedAt: status === "CLOSED" ? new Date(start + 25 * DAY) : null, prerequisiteIds: prereq,
      });
      projectTaskIds.push(tid);
      if (rnd() < 0.2) contributors.push({ taskId: tid, memberId: pick(mids.filter((m) => m.mid !== assignee.mid)).mid });
      if (rnd() < 0.2) {
        for (let c = 0; c < 3; c++) comments.push({ id: id("c"), taskId: tid, authorId: pick(mids).uid, body: `Commentaire ${c + 1} : avancement, questions et décisions sur la tâche.`, createdAt: new Date(start + c * DAY) });
      }
    }
  }
  for (let p = 0; p < n(40); p++) makeProject(`Projet perf ${String(p + 1).padStart(2, "0")}`, p % 5 === 4 ? 1 + (p % 20) : 0, 8, 4, n(400));
  makeProject("Projet géant", 0, 12, 6, n(4000));
  // Tâches sans projet
  for (let k = 0; k < n(500); k++) tasks.push({ id: id("t"), ownerId: me.id, name: `Tâche perso ${pick(VERBS)} ${pick(OBJECTS)} ${k}`, status: pick(STATUSES), priority: pick(PRIOS), order: k, dueDate: new Date(T0 + Math.floor(rnd() * 300) * DAY) });

  await prisma.project.createMany({ data: projects });
  await batched(members, 2000, (c) => prisma.projectMember.createMany({ data: c }));
  await batched(stages, 2000, (c) => prisma.stage.createMany({ data: c }));
  await batched(activities, 2000, (c) => prisma.activity.createMany({ data: c }));
  await batched(tasks, 2000, (c) => prisma.task.createMany({ data: c }));
  await batched(contributors, 2000, (c) => prisma.taskContributor.createMany({ data: c, skipDuplicates: true }));
  await batched(comments, 2000, (c) => prisma.taskComment.createMany({ data: c }));
  console.log(`Projets : ${projects.length}, tâches : ${tasks.length}, commentaires : ${comments.length}`);

  // Cartes mentales
  const nodes: Prisma.MindNodeCreateManyInput[] = [];
  const maps: Prisma.MindMapCreateManyInput[] = [];
  const nodeTasks: Prisma.MindNodeTaskCreateManyInput[] = [];
  function makeMap(title: string, size: number) {
    const mid = id("map");
    maps.push({ id: mid, ownerId: me.id, title });
    const ids: string[] = [];
    for (let k = 0; k < size; k++) {
      const nid = id("n");
      // Arbre équilibré : ~6 enfants par nœud.
      const parentId = k === 0 ? null : ids[Math.floor((k - 1) / 6)];
      nodes.push({ id: nid, mapId: mid, parentId, title: k === 0 ? title : `${pick(OBJECTS)} ${k}`, order: k, notes: rnd() < 0.05 ? "<p>Note du nœud</p>" : "", collapsed: false });
      ids.push(nid);
      if (rnd() < 0.03) nodeTasks.push({ nodeId: nid, taskId: tasks[Math.floor(rnd() * tasks.length)].id as string });
    }
  }
  for (let k = 0; k < n(25); k++) makeMap(`Carte perf ${k + 1}`, n(300));
  makeMap("Carte géante", n(5000));
  await prisma.mindMap.createMany({ data: maps });
  await batched(nodes, 2000, (c) => prisma.mindNode.createMany({ data: c }));
  await batched(nodeTasks, 2000, (c) => prisma.mindNodeTask.createMany({ data: c, skipDuplicates: true }));
  console.log(`Cartes : ${maps.length}, nœuds : ${nodes.length}`);

  // Messagerie
  const convs: Prisma.ConversationCreateManyInput[] = [];
  const parts: Prisma.ConversationParticipantCreateManyInput[] = [];
  const msgs: Prisma.MessageCreateManyInput[] = [];
  for (let c = 0; c < n(60); c++) {
    const cid = id("cv");
    const other = users[1 + (c % (users.length - 1))];
    const count = n(150);
    convs.push({ id: cid, createdById: me.id, createdAt: new Date(T0), lastMessageAt: new Date(T0 + count * 3_600_000) });
    parts.push({ conversationId: cid, userId: me.id, lastReadAt: new Date(T0 + (count - (c % 3)) * 3_600_000) }, { conversationId: cid, userId: other.id });
    for (let k = 0; k < count; k++) msgs.push({ id: id("msg"), conversationId: cid, authorId: k % 2 ? me.id : other.id, body: `<p>Message ${k + 1} de la conversation ${c + 1}</p>`, createdAt: new Date(T0 + k * 3_600_000) });
  }
  await prisma.conversation.createMany({ data: convs });
  await prisma.conversationParticipant.createMany({ data: parts });
  await batched(msgs, 2000, (c) => prisma.message.createMany({ data: c }));

  // Notifications
  const notifs: Prisma.NotificationCreateManyInput[] = Array.from({ length: n(3000) }, (_, k) => ({
    userId: me.id, type: "TASK_UPDATED" as const, title: `Tâche modifiée ${k}`, href: "/projects", readAt: k > 50 ? new Date(T0) : null, createdAt: new Date(T0 + k * 60_000),
  }));
  await batched(notifs, 2000, (c) => prisma.notification.createMany({ data: c }));
  console.log(`Messages : ${msgs.length}, notifications : ${notifs.length}`);
  console.log(`Terminé en ${((Date.now() - t) / 1000).toFixed(1)} s. Connexion : ${me.email} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
