/**
 * Tests purs des fonctionnalités « second cerveau » : liens entre objets
 * (assainissement, extraction), répétition espacée (Leitner), iCalendar,
 * reconstitution du passé (voyage dans le temps).
 *
 * Usage : npm run test:knowledge
 */
import { sanitizeNotes } from "../src/lib/sanitize";
import { extractRefs, linkHref } from "../src/lib/shared/links";
import { BOX_INTERVAL_DAYS, hash32, parisDay, pickDaily, reviewCard, seededOrder } from "../src/lib/shared/leitner";
import { buildCalendar, escapeText, foldLine, utcStamp } from "../src/lib/shared/ical";
import { rewindMap, rewindTask } from "../src/lib/shared/time-travel";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---- Liens [[…]] : assainissement
const html = sanitizeNotes(
  `<p><a href="/tasks/abc" data-ref="task:abc" target="_blank">T</a> <a href="https://x.com" data-ref="task:zzz">X</a> <a href="javascript:alert(1)">J</a> <a href="/p" data-ref="evil:1 onclick">E</a> <a href="//evil.com">P</a></p>`,
);
check("lien interne : data-ref conservé, même onglet", html.includes(`<a href="/tasks/abc" data-ref="task:abc" rel="noopener">T</a>`), html);
check("lien externe : data-ref retiré, nouvel onglet", html.includes(`<a href="https://x.com" rel="noopener noreferrer nofollow" target="_blank">X</a>`), html);
check("javascript: retiré", !html.includes("javascript"), html);
check("data-ref invalide retiré", !html.includes("evil:1"), html);
check("protocole relatif traité en externe", html.includes(`<a rel="noopener noreferrer nofollow" target="_blank">P</a>`) || !html.includes(`href="//evil.com"`), html);

// ---- Extraction des références
check("extraction : références uniques dans l'ordre", JSON.stringify(extractRefs(`<a data-ref="task:a">x</a><a data-ref="node:b">y</a><a data-ref="task:a">z</a>`)) === JSON.stringify(["task:a", "node:b"]));
check("extraction : ignore les valeurs invalides", extractRefs(`<a data-ref="foo:a">x</a>`).length === 0);
check("href d'un lien de tâche", linkHref({ kind: "task", id: "t1" }) === "/tasks/t1");
check("href d'un nœud", linkHref({ kind: "node", id: "n1", mapId: "m1" }) === "/mindmaps/m1?node=n1");
check("href d'une réunion", linkHref({ kind: "meeting", id: "r1", projectId: "p1" }) === "/projects/p1?meeting=r1#reunions");
check("href d'une étape (Prise de notes)", linkHref({ kind: "stage", id: "s1" }) === "/notes?ref=stage%3As1");

// ---- Leitner
const now = new Date("2026-10-18T10:00:00Z");
const r1 = reviewCard(0, "remember", now);
check("nouvelle note « toujours utile » → boîte 2", r1.box === 2 && !r1.archived && r1.dueAt.getTime() === now.getTime() + BOX_INTERVAL_DAYS[2] * 86_400_000);
check("« à revoir » → boîte 1", reviewCard(4, "again", now).box === 1);
check("boîte 5 plafonnée", reviewCard(5, "remember", now).box === 5);
check("« ne plus proposer » archive", reviewCard(3, "archive", now).archived);
check("jour de Paris (minuit passé en heure française)", parisDay(new Date("2026-10-18T22:30:00Z")) === "2026-10-19");
check("hachage stable", hash32("abc") === hash32("abc") && hash32("abc") !== hash32("abd"));
check("ordre déterministe", JSON.stringify(seededOrder(["a", "b", "c", "d"], (x) => x, "s")) === JSON.stringify(seededOrder(["d", "c", "b", "a"], (x) => x, "s")));
const past = new Date("2026-10-10T00:00:00Z");
const cards = [
  { ref: "task:late", dueAt: past, lastReviewedAt: null, archived: false },
  { ref: "task:later", dueAt: new Date("2026-10-12T00:00:00Z"), lastReviewedAt: null, archived: false },
  { ref: "task:future", dueAt: new Date("2026-11-01T00:00:00Z"), lastReviewedAt: null, archived: false },
  { ref: "task:arch", dueAt: past, lastReviewedAt: null, archived: true },
];
const pick = pickDaily(cards, ["task:f1", "task:f2", "task:late"], { userId: "u", now });
check("sélection : échues d'abord, puis une nouvelle", pick.length === 3 && pick[0] === "task:late" && pick[1] === "task:later" && pick[2].startsWith("task:f"), pick);
check("sélection : archivées et futures exclues", !pick.includes("task:arch") && !pick.includes("task:future"));
const reviewed = [...cards, { ref: "task:done", dueAt: new Date("2026-10-21T00:00:00Z"), lastReviewedAt: now, archived: false }];
check("sélection : le quota baisse avec les relectures du jour", pickDaily(reviewed, ["task:f1"], { userId: "u", now }).length === 2);
check("sélection : stable dans la journée", JSON.stringify(pickDaily([], ["a:1", "a:2", "a:3", "a:4", "a:5"], { userId: "u", now })) === JSON.stringify(pickDaily([], ["a:5", "a:4", "a:3", "a:2", "a:1"], { userId: "u", now: new Date("2026-10-18T20:00:00Z") })));

// ---- iCalendar
check("échappement iCal", escapeText("a,b;c\\d\ne") === "a\\,b\\;c\\\\d\\ne");
const long = "SUMMARY:" + "é".repeat(60);
const folded = foldLine(long);
check("repli à 75 octets", folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75) && folded.split("\r\n ").join("") === long);
check("horodatage UTC", utcStamp(new Date("2026-10-18T09:05:03.120Z")) === "20261018T090503Z");
const ics = buildCalendar("Test", [
  { uid: "task-1@sb", allDay: "2026-10-31", summary: "Échéance : Rendre, enfin", url: "https://x/tasks/1" },
  { uid: "meeting-1@sb", start: new Date("2026-10-20T08:00:00Z"), summary: "Réunion", location: "Salle 1" },
], now);
check("calendrier : enveloppe et CRLF", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n") && !/[^\r]\n/.test(ics));
check("calendrier : journée entière (fin exclusive au lendemain)", ics.includes("DTSTART;VALUE=DATE:20261031") && ics.includes("DTEND;VALUE=DATE:20261101"));
check("calendrier : réunion d'une heure", ics.includes("DTSTART:20261020T080000Z") && ics.includes("DTEND:20261020T090000Z"));
check("calendrier : texte échappé", ics.includes("SUMMARY:Échéance : Rendre\\, enfin"));
check("calendrier : 2 évènements", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 2);

// ---- Voyage dans le temps : tâche
const t = { name: "Murs", status: "DONE", progress: 100, priority: "HIGH", complexity: "MEDIUM", startDate: "2026-10-05", dueDate: "2026-10-20", assignee: "Bob" };
const ev = (at: string, field: string, oldValue: string | null, newValue: string | null, kind = "field") => ({ createdAt: new Date(at), kind, field, oldValue, newValue });
const events = [
  ev("2026-10-02T10:00:00Z", "status", "À faire", "En cours"),
  ev("2026-10-03T10:00:00Z", "progress", "0 %", "40 %"),
  ev("2026-10-10T10:00:00Z", "dueDate", "15/10/2026", "20/10/2026"),
  ev("2026-10-12T10:00:00Z", "status", "En cours", "Terminée"),
  ev("2026-10-12T11:00:00Z", "name", "Murs porteurs", "Murs"),
  ev("2026-10-11T10:00:00Z", "assigneeId", "Alice", "Bob", "assignee"),
];
const at9 = rewindTask(t, events, new Date("2026-10-09T00:00:00Z"));
check("tâche au 09/10 : en cours, 40 %", at9.status === "IN_PROGRESS" && at9.progress === 40, at9);
check("tâche au 09/10 : échéance d'alors", at9.dueDate === "2026-10-15", at9);
check("tâche au 09/10 : ancien nom et responsable", at9.name === "Murs porteurs" && at9.assignee === "Alice", at9);
const at1 = rewindTask(t, events, new Date("2026-10-01T00:00:00Z"));
check("tâche au 01/10 : à faire, 0 %", at1.status === "TODO" && at1.progress === 0, at1);
check("tâche aujourd'hui : inchangée", JSON.stringify(rewindTask(t, events, new Date("2026-10-30T00:00:00Z"))) === JSON.stringify(t));

// ---- Voyage dans le temps : carte
const nodes = [
  { id: "r", parentId: null, title: "Racine", status: "OPEN", color: null, createdAt: new Date("2026-09-01T00:00:00Z") },
  { id: "a", parentId: "r", title: "Idée finale", status: "CLOSED", color: "#f00", createdAt: new Date("2026-09-02T00:00:00Z") },
  { id: "b", parentId: "r", title: "Récente", status: "OPEN", color: null, createdAt: new Date("2026-10-15T00:00:00Z") },
];
const mev = [
  { createdAt: new Date("2026-10-05T00:00:00Z"), kind: "node_renamed", nodeId: "a", nodeTitle: "Idée", oldValue: "Idée", newValue: "Idée finale" },
  { createdAt: new Date("2026-10-06T00:00:00Z"), kind: "node_status", nodeId: "a", nodeTitle: "Idée finale", oldValue: "WATCH", newValue: "CLOSED" },
  { createdAt: new Date("2026-10-07T00:00:00Z"), kind: "node_deleted", nodeId: "z", nodeTitle: "Abandonnée", oldValue: "Abandonnée", newValue: null },
];
const m = rewindMap(nodes, mev, new Date("2026-10-01T00:00:00Z"));
check("carte au 01/10 : nœud créé après exclu", m.nodes.every((n) => n.id !== "b"));
check("carte au 01/10 : ancien titre et statut", m.nodes.find((n) => n.id === "a")?.title === "Idée" && m.nodes.find((n) => n.id === "a")?.status === "WATCH");
check("carte au 01/10 : nœud supprimé depuis signalé", m.deletedSince.length === 1 && m.deletedSince[0].title === "Abandonnée");

console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
if (failures) process.exit(1);
