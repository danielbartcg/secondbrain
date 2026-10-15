/**
 * Mesures de réactivité sur le jeu de données `npm run perf:seed`.
 *
 * Usage (serveur lancé, de préférence `npm run build && npm start`) :
 *   npm run perf:bench                 # http://localhost:3000 (BASE_URL sinon)
 *   RUNS=10 npm run perf:bench
 *
 * Ouvre une session pour perf-000 directement en base, chauffe chaque route
 * (compilation à la demande en dev) puis mesure RUNS appels : médiane, p95,
 * taille de la réponse. Les seuils indicatifs (autocomplétion < 150 ms,
 * ouverture < 800 ms) sont signalés par ⚠.
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUNS = Number(process.env.RUNS ?? 7);
const prisma = new PrismaClient();

async function main() {
  const me = await prisma.user.findUnique({ where: { email: "perf-000@perf.local" } });
  if (!me) throw new Error("Jeu de données absent : npm run perf:seed");
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: me.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000), label: "perf-bench" } });
  const giant = await prisma.project.findFirstOrThrow({ where: { ownerId: me.id, name: "Projet géant" } });
  const normal = await prisma.project.findFirstOrThrow({ where: { ownerId: me.id, name: "Projet perf 01" } });
  const bigMap = await prisma.mindMap.findFirstOrThrow({ where: { ownerId: me.id, title: "Carte géante" } });
  const map = await prisma.mindMap.findFirstOrThrow({ where: { ownerId: me.id, title: "Carte perf 1" } });
  const task = await prisma.task.findFirstOrThrow({ where: { projectId: giant.id, comments: { some: {} } } });
  const conv = await prisma.conversation.findFirstOrThrow({ where: { participants: { some: { userId: me.id } } } });

  const cases: { name: string; path: string; budget: number; page?: boolean }[] = [
    { name: "Recherche « ana » (autocomplétion)", path: "/api/v1/search?q=ana&limit=6", budget: 150 },
    { name: "Recherche « migration 12 »", path: "/api/v1/search?q=migration%2012&limit=6", budget: 150 },
    { name: "Recherche 1 lettre « l »", path: "/api/v1/search?q=l&limit=6", budget: 150 },
    { name: "Contacts messagerie", path: "/api/v1/messages/contacts", budget: 150 },
    { name: "Badge messages non lus", path: "/api/v1/messages/unread", budget: 100 },
    { name: "Notifications (30)", path: "/api/v1/notifications?limit=30", budget: 150 },
    { name: "Épingles", path: "/api/v1/me/pins", budget: 100 },
    { name: "Tableau de bord", path: "/api/v1/dashboard", budget: 800 },
    { name: "Mes tâches", path: "/api/v1/me/tasks", budget: 800 },
    { name: "Liste des projets", path: "/api/v1/projects", budget: 500 },
    { name: "Projet (400 tâches)", path: `/api/v1/projects/${normal.id}`, budget: 500 },
    { name: "Projet géant (4 000 tâches)", path: `/api/v1/projects/${giant.id}`, budget: 1500 },
    { name: "Tâche + commentaires", path: `/api/v1/tasks/${task.id}`, budget: 300 },
    { name: "Historique d'une tâche", path: `/api/v1/tasks/${task.id}/history`, budget: 300 },
    { name: "Liste des cartes", path: "/api/v1/mindmaps", budget: 300 },
    { name: "Carte (300 nœuds)", path: `/api/v1/mindmaps/${map.id}`, budget: 400 },
    { name: "Carte géante (5 000 nœuds)", path: `/api/v1/mindmaps/${bigMap.id}`, budget: 1500 },
    { name: "Arbre des notes", path: "/api/v1/notes/tree", budget: 800 },
    { name: "Conversations", path: "/api/v1/messages/conversations", budget: 300 },
    { name: "Fil de messages", path: `/api/v1/messages/conversations/${conv.id}`, budget: 300 },
    { name: "Réunions du projet géant", path: `/api/v1/projects/${giant.id}/meetings`, budget: 300 },
    { name: "Risques du projet géant", path: `/api/v1/projects/${giant.id}/risks`, budget: 300 },
    { name: "Admin : utilisateurs", path: "/api/v1/admin/users", budget: 500 },
    { name: "Admin : toutes les tâches", path: "/api/v1/admin/tasks", budget: 1500 },
    { name: "Page accueil", path: "/dashboard", budget: 1000, page: true },
    { name: "Page projets", path: "/projects", budget: 1000, page: true },
    { name: "Page projet géant", path: `/projects/${giant.id}`, budget: 2000, page: true },
    { name: "Page cartes", path: "/mindmaps", budget: 1000, page: true },
    { name: "Page carte géante", path: `/mindmaps/${bigMap.id}`, budget: 2000, page: true },
    { name: "Page notes", path: "/notes", budget: 1500, page: true },
    { name: "Page messages", path: "/messages", budget: 1000, page: true },
    { name: "Page organiser", path: "/organize", budget: 1500, page: true },
  ];

  const headers = { Authorization: `Bearer ${token}`, Cookie: `session=${token}` };
  console.log(`${ORIGIN} — ${RUNS} mesures par route\n`);
  console.log("Route".padEnd(40), "médiane".padStart(8), "p95".padStart(8), "taille".padStart(10));
  const slow: string[] = [];
  for (const c of cases) {
    const url = ORIGIN + c.path;
    const first = await fetch(url, { headers });
    if (!first.ok) {
      console.log(c.name.padEnd(40), `HTTP ${first.status}`);
      slow.push(`${c.name} : HTTP ${first.status}`);
      continue;
    }
    await first.arrayBuffer();
    const times: number[] = [];
    let size = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const r = await fetch(url, { headers });
      size = (await r.arrayBuffer()).byteLength;
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)];
    const flag = med > c.budget ? " ⚠" : "";
    if (flag) slow.push(`${c.name} : ${med.toFixed(0)} ms (budget ${c.budget})`);
    console.log(c.name.padEnd(40), `${med.toFixed(0)} ms`.padStart(8), `${p95.toFixed(0)} ms`.padStart(8), `${(size / 1024).toFixed(0)} Ko`.padStart(10) + flag);
  }
  console.log(slow.length ? `\nAu-dessus du budget :\n- ${slow.join("\n- ")}` : "\nToutes les routes sont dans leur budget.");
  await prisma.session.deleteMany({ where: { userId: me.id, label: "perf-bench" } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
