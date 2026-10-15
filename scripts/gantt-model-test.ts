/**
 * Tests du modèle pur du Gantt (src/components/gantt/ganttModel.ts).
 *
 * Usage : npx tsx scripts/gantt-model-test.ts
 */
import {
  ROW_H,
  applyDrag,
  buildLinks,
  buildRows,
  conflictIds,
  dayIso,
  dayNum,
  dependentsOf,
  fmtRange,
  headerTiers,
  isoWeek,
  planUpdates,
  routeLink,
  roundedPath,
  snapDays,
  stageSpan,
  taskSpan,
  timelineRange,
  type GProject,
  type GTask,
  type Span,
} from "../src/components/gantt/ganttModel";

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
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const task = (id: string, startDate: string | null, dueDate: string | null, prerequisiteIds: string[] = [], progress = 0): GTask => ({
  id,
  name: id.toUpperCase(),
  status: "TODO",
  progress,
  startDate,
  dueDate,
  prerequisiteIds,
});

// ---- Dates
check("dayNum / dayIso aller-retour", dayIso(dayNum("2026-10-12")) === "2026-10-12");
check("dayNum ignore l'heure", dayNum("2026-10-12T22:00:00.000Z") === dayNum("2026-10-12"));
check("semaine ISO du 12/10/2026 = 42", isoWeek(dayNum("2026-10-12")) === 42);
check("semaine ISO du 01/01/2027 = 53", isoWeek(dayNum("2027-01-01")) === 53);
check("fmtRange", fmtRange({ start: dayNum("2026-10-12"), end: dayNum("2026-10-16") }) === "Lun 12 oct. → Ven 16 oct. (5 j)", fmtRange({ start: dayNum("2026-10-12"), end: dayNum("2026-10-16") }));

// ---- Étendues
check("taskSpan deux dates", eq(taskSpan(task("a", "2026-10-12", "2026-10-14")), { start: dayNum("2026-10-12"), end: dayNum("2026-10-14") }));
check("taskSpan une seule date = 1 jour", eq(taskSpan(task("a", null, "2026-10-14")), { start: dayNum("2026-10-14"), end: dayNum("2026-10-14") }));
check("taskSpan échéance avant début ⇒ bornée", eq(taskSpan(task("a", "2026-10-14", "2026-10-10")), { start: dayNum("2026-10-14"), end: dayNum("2026-10-14") }));
check("taskSpan sans date = null", taskSpan(task("a", null, null)) === null);

// ---- Accrochage au jour
check("snap 0 px", snapDays(0, 16) === 0 && !Object.is(snapDays(-3, 16), -0));
check("snap 7 px / 16 = 0", snapDays(7, 16) === 0);
check("snap 9 px / 16 = 1", snapDays(9, 16) === 1);
check("snap -41 px / 16 = -3", snapDays(-41, 16) === -3);

// ---- Déplacer / redimensionner
const s: Span = { start: 100, end: 104 };
check("move +3", eq(applyDrag(s, "move", 3), { start: 103, end: 107 }));
check("start -2", eq(applyDrag(s, "start", -2), { start: 98, end: 104 }));
check("start +10 plafonné à la fin (1 jour mini)", eq(applyDrag(s, "start", 10), { start: 104, end: 104 }));
check("end +2", eq(applyDrag(s, "end", 2), { start: 100, end: 106 }));
check("end -10 plancher au début", eq(applyDrag(s, "end", -10), { start: 100, end: 100 }));

// ---- Dépendantes et cascade
const chain = [
  task("a", "2026-10-12", "2026-10-14"),
  task("b", "2026-10-15", "2026-10-16", ["a"]),
  task("c", "2026-10-19", "2026-10-20", ["b"]),
  task("d", null, "2026-10-21", ["a"]),
  task("e", null, null, ["c"]),
  task("x", "2026-10-12", "2026-10-13"),
];
check("dépendantes transitives de a", eq(dependentsOf("a", chain).sort(), ["b", "c", "d", "e"]));
check("dépendantes de c", eq(dependentsOf("c", chain), ["e"]));
check("pas de dépendantes pour x", dependentsOf("x", chain).length === 0);

const mv = planUpdates(chain, "a", "move", 2, true);
check("cascade move : a, b, c, d (e sans date ignorée)", eq(mv.map((u) => u.id).sort(), ["a", "b", "c", "d"]), mv);
check("cascade move : dates décalées", eq(mv.find((u) => u.id === "b"), { id: "b", startDate: "2026-10-17", dueDate: "2026-10-18" }));
check("cascade move : date nulle conservée", eq(mv.find((u) => u.id === "d"), { id: "d", startDate: null, dueDate: "2026-10-23" }));
check("move sans cascade : seule la tâche", eq(planUpdates(chain, "a", "move", 2, false).map((u) => u.id), ["a"]));
const re = planUpdates(chain, "a", "end", 3, true);
check("fin repoussée : dépendantes décalées du décalage de fin", eq(re.find((u) => u.id === "c"), { id: "c", startDate: "2026-10-22", dueDate: "2026-10-23" }), re);
check("fin repoussée : les deux dates fixées", eq(re[0], { id: "a", startDate: "2026-10-12", dueDate: "2026-10-17" }));
check("fin avancée : pas de cascade", eq(planUpdates(chain, "a", "end", -1, true).map((u) => u.id), ["a"]));
check("début modifié : pas de cascade", eq(planUpdates(chain, "a", "start", -1, true).map((u) => u.id), ["a"]));
check("redimensionner une tâche à une date fixe les deux", eq(planUpdates(chain, "d", "start", -2, false), [{ id: "d", startDate: "2026-10-19", dueDate: "2026-10-21" }]));
check("delta nul ⇒ rien", planUpdates(chain, "a", "move", 0, true).length === 0);
check("redimensionnement sans effet ⇒ rien", planUpdates([task("z", "2026-10-12", "2026-10-12")], "z", "start", 3, true).length === 0);

// ---- Conflits (règle de schedulingConflicts)
const spans = new Map(chain.map((t) => [t.id, taskSpan(t)!]).filter(([, v]) => v) as [string, Span][]);
check("aucun conflit dans la chaîne", conflictIds(chain, spans).size === 0);
const late = [task("p", "2026-10-12", "2026-10-15"), task("q", "2026-10-14", "2026-10-16", ["p"]), task("r", "2026-10-15", "2026-10-16", ["p"])];
const lateSpans = new Map(late.map((t) => [t.id, taskSpan(t)!]));
check("conflit si le prérequis finit après le début", eq([...conflictIds(late, lateSpans)].sort(), ["q"]));

// ---- Hiérarchie des lignes
const project: GProject = {
  stages: [
    {
      id: "s1",
      name: "Étape 1",
      startDate: null,
      dueDate: null,
      progress: { percent: 40 },
      activities: [{ id: "a1", name: "Activité", progress: { percent: 50 }, tasks: [task("t1", "2026-10-12", "2026-10-13"), task("t2", null, null)] }],
      tasks: [task("t3", "2026-10-20", "2026-10-22")],
    },
    { id: "s2", name: "Étape vide", startDate: null, dueDate: null, progress: { percent: 0 }, activities: [], tasks: [] },
    { id: "s3", name: "Étape datée", startDate: "2026-11-01", dueDate: null, progress: { percent: 0 }, activities: [], tasks: [task("t4", "2026-11-03", "2026-11-05")] },
  ],
  tasks: [task("t5", "2026-10-30", null, [], 20), task("t6", "2026-10-31", "2026-11-02", [], 60)],
};
const palette = ["#111", "#222", "#333"];
const { rows, planned, groupKeys } = buildRows(project, new Set(), palette);
check(
  "ordre : étape › activité › tâches, tâches directes, étape suivante, Sans étape",
  eq(rows.map((r) => r.key), ["stage:s1", "activity:a1", "t1", "t3", "stage:s3", "t4", "group:none", "t5", "t6"]),
  rows.map((r) => r.key),
);
check("niveaux", eq(rows.map((r) => r.level), [0, 1, 2, 1, 0, 1, 0, 1, 1]));
check("étape sans tâche datée ni dates masquée", !rows.some((r) => r.key === "stage:s2"));
check("tâche sans date exclue", !planned.some((p) => p.task.id === "t2"));
check("couleur de l'étape 3 = palette[2]", rows.find((r) => r.key === "t4")?.color === "#333");
check("synthèse étape 1 = union des tâches", eq(rows[0].span, { start: dayNum("2026-10-12"), end: dayNum("2026-10-22") }));
check("synthèse activité", eq(rows[1].span, { start: dayNum("2026-10-12"), end: dayNum("2026-10-13") }));
check("étape datée : début propre, fin par les tâches", eq(rows[4].span, { start: dayNum("2026-11-01"), end: dayNum("2026-11-05") }));
check("groupe Sans étape : moyenne d'avancement", rows[6].percent === 40);
check("clés de groupe", eq(groupKeys.sort(), ["activity:a1", "group:none", "stage:s1", "stage:s3"]));
const folded = buildRows(project, new Set(["stage:s1", "activity:a1"]), palette);
check("étape repliée : enfants masqués", eq(folded.rows.map((r) => r.key), ["stage:s1", "stage:s3", "t4", "group:none", "t5", "t6"]));
check("étape repliée : tâches toujours planifiées", folded.planned.length === 5);
const actFolded = buildRows(project, new Set(["activity:a1"]), palette);
check("activité repliée", eq(actFolded.rows.map((r) => r.key).slice(0, 3), ["stage:s1", "activity:a1", "t3"]));
check("stageSpan dates propres", eq(stageSpan({ startDate: "2026-10-01", dueDate: "2026-10-10" }, []), { start: dayNum("2026-10-01"), end: dayNum("2026-10-10") }));
check("stageSpan sans rien = null", stageSpan({ startDate: null, dueDate: null }, []) === null);

// ---- Frise
const today = dayNum("2026-10-15");
const wr = timelineRange([{ start: dayNum("2026-10-12"), end: dayNum("2026-10-20") }], today, "week");
check("plage semaine commence un lundi", new Date(wr.start * 86_400_000).getUTCDay() === 1);
check("plage semaine finit un dimanche", new Date(wr.end * 86_400_000).getUTCDay() === 0);
const mr = timelineRange([{ start: dayNum("2026-10-12"), end: dayNum("2026-10-20") }], today, "month");
check("plage mois alignée sur le 1er", dayIso(mr.start).endsWith("-01"));
const ht = headerTiers({ start: dayNum("2026-10-12"), end: dayNum("2026-11-08") }, "week");
check("en-tête semaine : 4 semaines", ht.lower.length === 4 && ht.lower[0].label === "S42", ht.lower.map((c) => c.label));
check("en-tête semaine : mois octobre puis novembre", eq(ht.upper.map((c) => c.label), ["octobre 2026", "novembre 2026"]));
const hd = headerTiers({ start: dayNum("2026-10-12"), end: dayNum("2026-10-18") }, "day");
check("en-tête jour : initiales", eq(hd.lower.map((c) => c.sub).join(""), "LMMJVSD"));

// ---- Liens
const direct = routeLink(100, 17, 160, 51);
check("lien direct : 4 points, coude à x1+10", !direct.around && eq(direct.points, [[100, 17], [110, 17], [110, 51], [160, 51]]));
const touching = routeLink(100, 17, 100, 51);
check("lien collé (fin → lendemain) : contournement", touching.around && touching.points.length === 6);
check("contournement par l'intervalle entre lignes", touching.points[2][1] === 51 - ROW_H / 2 && touching.points[3][0] === 90);
const upward = routeLink(100, 85, 60, 17);
check("successeur au-dessus : intervalle sous sa ligne", upward.around && upward.points[2][1] === 17 + ROW_H / 2);
const d = roundedPath(direct.points, 4);
check("chemin arrondi : départ et arrivée", d.startsWith("M100,17") && d.endsWith("L160,51"), d);
check("chemin arrondi : 2 coins", (d.match(/Q/g) ?? []).length === 2, d);
check("chemin : points alignés fusionnés", (roundedPath([[0, 0], [5, 0], [10, 0], [10, 10]]).match(/Q/g) ?? []).length === 1);

const linkTasks = [task("p", "2026-10-12", "2026-10-14"), task("q", "2026-10-13", "2026-10-15", ["p"]), task("r", "2026-10-20", "2026-10-21", ["p"])];
const lSpans = new Map(linkTasks.map((t) => [t.id, taskSpan(t)!]));
const idx = new Map([["p", 0], ["q", 1], ["r", 2]]);
const base = dayNum("2026-10-12");
const links = buildLinks(linkTasks, lSpans, idx, (n) => (n - base) * 10);
const lq = links.find((l) => l.to === "q")!;
const lr = links.find((l) => l.to === "r")!;
check("lien en conflit : marqué et contourné", lq.conflict && lq.around);
check("lien normal : direct, non conflictuel", !lr.conflict && !lr.around);
check("lien part du bord droit (fin incluse + 1 jour)", lr.points[0][0] === 30 && lr.points[lr.points.length - 1][0] === 80);
check("lien vers ligne masquée ignoré", buildLinks(linkTasks, lSpans, new Map([["p", 0], ["q", 1]]), (n) => n).length === 1);

console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
if (failures) process.exit(1);
