/**
 * Modèle pur du diagramme de Gantt (aucune dépendance React ni serveur) :
 * dates en « jours » entiers (jours UTC depuis l'époque), hiérarchie des
 * lignes (étape › activité › tâche), bornes de la frise, en-têtes à deux
 * niveaux, calcul des déplacements / redimensionnements, cascade sur les
 * tâches dépendantes et tracé des liens fin → début.
 *
 * Testé par `npx tsx scripts/gantt-model-test.ts`.
 */

export const DAY_MS = 86_400_000;

export type GanttScale = "day" | "week" | "month";

/** Pixels par jour selon l'échelle. */
export const SCALE_PX: Record<GanttScale, number> = { day: 32, week: 16, month: 5 };

export const ROW_H = 34;
/** Décrochage horizontal d'un lien avant de tourner. */
export const LINK_GAP = 10;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "AAAA-MM-JJ…" → numéro de jour (UTC). */
export function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Numéro de jour → "AAAA-MM-JJ". */
export function dayIso(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Aujourd'hui (date locale du navigateur) en numéro de jour. */
export function todayNum(now: Date = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/** 0 = dimanche … 6 = samedi. */
export const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay();
export const isWeekend = (n: number) => {
  const w = weekday(n);
  return w === 0 || w === 6;
};
/** Lundi de la semaine du jour `n`. */
export const mondayOf = (n: number) => n - ((weekday(n) + 6) % 7);
/** Premier jour du mois du jour `n`. */
export function monthStart(n: number): number {
  const d = new Date(n * DAY_MS);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS);
}
/** Premier jour du mois suivant. */
export function nextMonth(n: number): number {
  const d = new Date(n * DAY_MS);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS);
}
function nextYear(n: number): number {
  const d = new Date(n * DAY_MS);
  return Math.round(Date.UTC(d.getUTCFullYear() + 1, 0, 1) / DAY_MS);
}
function yearStart(n: number): number {
  return Math.round(Date.UTC(new Date(n * DAY_MS).getUTCFullYear(), 0, 1) / DAY_MS);
}

/** Numéro de semaine ISO 8601. */
export function isoWeek(n: number): number {
  const thursday = mondayOf(n) + 3;
  const jan1 = yearStart(thursday);
  return Math.floor((thursday - jan1) / 7) + 1;
}

const WD_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const WD_INITIAL = ["D", "L", "M", "M", "J", "V", "S"];
const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTH_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « Lun 12 oct. » */
export function fmtDay(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${WD_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}
/** « 12/10/26 » (colonnes de la grille). */
export function fmtShort(n: number): string {
  const d = new Date(n * DAY_MS);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`;
}
/** Durée inclusive en jours. */
export const duration = (s: Span) => s.end - s.start + 1;
/** « Lun 12 oct. → Ven 16 oct. (5 j) » */
export function fmtRange(s: Span): string {
  return `${fmtDay(s.start)} → ${fmtDay(s.end)} (${duration(s)} j)`;
}

// ---------------------------------------------------------------------------
// Tâches, étendues, conflits
// ---------------------------------------------------------------------------

/** Étendue inclusive en jours (start ≤ end). */
export type Span = { start: number; end: number };

/** Forme minimale d'une tâche (TaskDto est compatible). */
export type GTask = {
  id: string;
  name: string;
  status: string;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  prerequisiteIds?: string[] | null;
};
type GProgress = { percent: number };
export type GActivity = { id: string; name: string; progress: GProgress; tasks: GTask[] };
export type GStage = {
  id: string;
  name: string;
  startDate: string | null;
  dueDate: string | null;
  progress: GProgress;
  activities: GActivity[];
  tasks: GTask[];
};
export type GProject = { stages: GStage[]; tasks: GTask[] };

/** Étendue d'une tâche : une seule date ⇒ barre d'un jour ; null si aucune date. */
export function taskSpan(t: { startDate: string | null; dueDate: string | null }): Span | null {
  const s = t.startDate ?? t.dueDate;
  const e = t.dueDate ?? t.startDate;
  if (!s || !e) return null;
  const start = dayNum(s);
  return { start, end: Math.max(start, dayNum(e)) };
}

/**
 * Règle de conflit (identique à `schedulingConflicts`) : un prérequis est en
 * conflit si son échéance (ou son début à défaut) est strictement postérieure
 * au début (ou à l'échéance à défaut) de la tâche.
 */
export function isConflict(pred: Span, succ: Span): boolean {
  return pred.end > succ.start;
}

/** Ids des tâches dont au moins un prérequis daté est en conflit. */
export function conflictIds(tasks: GTask[], spans: Map<string, Span>): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    const me = spans.get(t.id);
    if (!me) continue;
    for (const pid of t.prerequisiteIds ?? []) {
      const p = spans.get(pid);
      if (p && isConflict(p, me)) {
        out.add(t.id);
        break;
      }
    }
  }
  return out;
}

/** Tâches qui dépendent (directement ou non) de `id`, sans `id` lui-même. */
export function dependentsOf(id: string, tasks: GTask[]): string[] {
  const succ = new Map<string, string[]>();
  for (const t of tasks) for (const p of t.prerequisiteIds ?? []) succ.set(p, [...(succ.get(p) ?? []), t.id]);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of succ.get(cur) ?? []) {
      if (s === id || out.has(s)) continue;
      out.add(s);
      stack.push(s);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Glisser : déplacer / redimensionner
// ---------------------------------------------------------------------------

export type DragMode = "move" | "start" | "end";

/** Décalage en pixels → nombre entier de jours. */
export function snapDays(dx: number, pxPerDay: number): number {
  const d = Math.round(dx / pxPerDay);
  return d === 0 ? 0 : d; // évite -0
}

/** Nouvelle étendue : déplacement, ou bord gauche / droit (au moins un jour). */
export function applyDrag(span: Span, mode: DragMode, delta: number): Span {
  if (mode === "move") return { start: span.start + delta, end: span.end + delta };
  if (mode === "start") return { start: Math.min(span.start + delta, span.end), end: span.end };
  return { start: span.start, end: Math.max(span.end + delta, span.start) };
}

export type DateUpdate = { id: string; startDate: string | null; dueDate: string | null };

function shiftIso(iso: string | null, days: number): string | null {
  return iso ? dayIso(dayNum(iso) + days) : null;
}

/**
 * Mises à jour à envoyer après un glisser :
 *  - la tâche glissée : en déplacement, ses dates existantes sont décalées ;
 *    en redimensionnement, début et échéance sont tous deux fixés ;
 *  - cascade (option) : déplacement ⇒ toutes les dépendantes (transitives)
 *    décalées du même nombre de jours ; fin repoussée ⇒ dépendantes décalées
 *    du décalage de la fin ; début modifié ou fin avancée ⇒ rien.
 */
export function planUpdates(tasks: GTask[], id: string, mode: DragMode, delta: number, cascade: boolean): DateUpdate[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const t = byId.get(id);
  const span = t && taskSpan(t);
  if (!t || !span || delta === 0) return [];
  const next = applyDrag(span, mode, delta);
  if (next.start === span.start && next.end === span.end) return [];
  const out: DateUpdate[] =
    mode === "move"
      ? [{ id, startDate: shiftIso(t.startDate, delta), dueDate: shiftIso(t.dueDate, delta) }]
      : [{ id, startDate: dayIso(next.start), dueDate: dayIso(next.end) }];
  const shift = mode === "move" ? delta : mode === "end" && next.end > span.end ? next.end - span.end : 0;
  if (cascade && shift !== 0) {
    for (const dep of dependentsOf(id, tasks)) {
      const d = byId.get(dep);
      if (!d || !taskSpan(d)) continue;
      out.push({ id: dep, startDate: shiftIso(d.startDate, shift), dueDate: shiftIso(d.dueDate, shift) });
    }
  }
  return out;
}

/** Étendues effectives après des mises à jour (aperçu pendant le glisser). */
export function previewSpans(updates: DateUpdate[]): Map<string, Span> {
  const m = new Map<string, Span>();
  for (const u of updates) {
    const s = taskSpan(u);
    if (s) m.set(u.id, s);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Lignes hiérarchiques
// ---------------------------------------------------------------------------

export const NO_STAGE_COLOR = "#94a3b8";

export type GanttRow =
  | {
      kind: "stage" | "activity" | "group";
      key: string;
      level: number;
      name: string;
      color: string;
      span: Span | null;
      percent: number;
      collapsed: boolean;
      count: number;
    }
  | {
      kind: "task";
      key: string;
      level: number;
      name: string;
      color: string;
      span: Span;
      percent: number;
      task: GTask;
    };

export type PlannedTask = { task: GTask; color: string; parents: string[] };

export function unionSpan(spans: (Span | null | undefined)[]): Span | null {
  let out: Span | null = null;
  for (const s of spans) {
    if (!s) continue;
    out = out ? { start: Math.min(out.start, s.start), end: Math.max(out.end, s.end) } : { ...s };
  }
  return out;
}

/**
 * Étendue d'une étape : ses propres dates si renseignées (complétées par
 * celles des tâches pour la borne manquante), sinon l'union de ses tâches.
 */
export function stageSpan(stage: { startDate: string | null; dueDate: string | null }, taskSpans: Span[]): Span | null {
  const fromTasks = unionSpan(taskSpans);
  if (!stage.startDate && !stage.dueDate) return fromTasks;
  const start = stage.startDate ? dayNum(stage.startDate) : (fromTasks?.start ?? dayNum(stage.dueDate!));
  const end = stage.dueDate ? dayNum(stage.dueDate) : (fromTasks?.end ?? start);
  return { start, end: Math.max(start, end) };
}

/**
 * Lignes visibles dans l'ordre du plan : étape, puis ses activités (et leurs
 * tâches), puis ses tâches directes ; enfin le groupe « Sans étape ». Seules
 * les tâches datées apparaissent ; une étape sans tâche datée n'apparaît que
 * si elle a ses propres dates. `spans` permet de surcharger les dates
 * (brouillon optimiste).
 */
export function buildRows(
  project: GProject,
  collapsed: ReadonlySet<string>,
  palette: readonly string[],
  spanOf: (t: GTask) => Span | null = taskSpan,
): { rows: GanttRow[]; planned: PlannedTask[]; groupKeys: string[] } {
  const rows: GanttRow[] = [];
  const planned: PlannedTask[] = [];
  const groupKeys: string[] = [];
  const avg = (ts: GTask[]) => (ts.length ? Math.round(ts.reduce((a, t) => a + t.progress, 0) / ts.length) : 0);

  const taskRows = (ts: GTask[], level: number, color: string, parents: string[]) => {
    const out: GanttRow[] = [];
    for (const t of ts) {
      const span = spanOf(t);
      if (!span) continue;
      planned.push({ task: t, color, parents });
      out.push({ kind: "task", key: t.id, level, name: t.name, color, span, percent: t.progress, task: t });
    }
    return out;
  };

  project.stages.forEach((s, i) => {
    const color = palette[i % palette.length];
    const sKey = `stage:${s.id}`;
    const children: GanttRow[] = [];
    for (const a of s.activities) {
      const aKey = `activity:${a.id}`;
      const tr = taskRows(a.tasks, 2, color, [sKey, aKey]);
      if (!tr.length) continue;
      groupKeys.push(aKey);
      const aCollapsed = collapsed.has(aKey);
      children.push({
        kind: "activity",
        key: aKey,
        level: 1,
        name: a.name,
        color,
        span: unionSpan(tr.map((r) => r.span)),
        percent: a.progress.percent,
        collapsed: aCollapsed,
        count: tr.length,
      });
      if (!aCollapsed) children.push(...tr);
    }
    const direct = taskRows(s.tasks, 1, color, [sKey]);
    const all = planned.filter((p) => p.parents[0] === sKey).map((p) => spanOf(p.task)!);
    const span = stageSpan(s, all);
    if (!all.length && !span) return;
    groupKeys.push(sKey);
    const sCollapsed = collapsed.has(sKey);
    rows.push({ kind: "stage", key: sKey, level: 0, name: s.name, color, span, percent: s.progress.percent, collapsed: sCollapsed, count: all.length });
    if (!sCollapsed) rows.push(...children, ...direct);
  });

  const loose = taskRows(project.tasks, 1, NO_STAGE_COLOR, ["group:none"]);
  if (loose.length) {
    groupKeys.push("group:none");
    const c = collapsed.has("group:none");
    rows.push({
      kind: "group",
      key: "group:none",
      level: 0,
      name: "Sans étape",
      color: NO_STAGE_COLOR,
      span: unionSpan(loose.map((r) => r.span)),
      percent: avg(project.tasks.filter((t) => spanOf(t))),
      collapsed: c,
      count: loose.length,
    });
    if (!c) rows.push(...loose);
  }
  return { rows, planned, groupKeys };
}

// ---------------------------------------------------------------------------
// Frise : bornes et en-têtes
// ---------------------------------------------------------------------------

const PAD: Record<GanttScale, number> = { day: 7, week: 14, month: 31 };
const MIN_SPAN: Record<GanttScale, number> = { day: 42, week: 16 * 7, month: 365 };

/** Bornes [min, max] (jours inclus) de la frise, alignées sur la semaine ou le mois. */
export function timelineRange(spans: (Span | null)[], today: number, scale: GanttScale): Span {
  const u = unionSpan([...spans, { start: today, end: today }])!;
  let start = u.start - PAD[scale];
  let end = u.end + PAD[scale];
  if (end - start + 1 < MIN_SPAN[scale]) end = start + MIN_SPAN[scale] - 1;
  if (scale === "month") {
    start = monthStart(start);
    end = nextMonth(end) - 1;
  } else {
    start = mondayOf(start);
    end = mondayOf(end) + 6;
  }
  return { start, end };
}

export type HeaderCell = { start: number; end: number; label: string; title?: string; sub?: string };

function cut(range: Span, first: number, next: (n: number) => number, label: (n: number) => HeaderCell["label"], extra?: (n: number) => Partial<HeaderCell>): HeaderCell[] {
  const out: HeaderCell[] = [];
  for (let a = first; a <= range.end; a = next(a)) {
    const s = Math.max(a, range.start);
    const e = Math.min(next(a) - 1, range.end);
    out.push({ start: s, end: e, label: label(a), ...(extra?.(a) ?? {}) });
  }
  return out;
}

/** En-tête à deux niveaux selon l'échelle. */
export function headerTiers(range: Span, scale: GanttScale): { upper: HeaderCell[]; lower: HeaderCell[] } {
  const monthLabel = (n: number) => {
    const d = new Date(n * DAY_MS);
    return `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  if (scale === "month") {
    return {
      upper: cut(range, yearStart(range.start), nextYear, (n) => String(new Date(n * DAY_MS).getUTCFullYear())),
      lower: cut(range, monthStart(range.start), nextMonth, (n) => MONTH_LONG[new Date(n * DAY_MS).getUTCMonth()]),
    };
  }
  const upper = cut(range, monthStart(range.start), nextMonth, monthLabel);
  if (scale === "week") {
    return {
      upper,
      lower: cut(
        range,
        mondayOf(range.start),
        (n) => n + 7,
        (n) => `S${isoWeek(n)}`,
        (n) => ({ sub: `${new Date(n * DAY_MS).getUTCDate()} ${MONTH_SHORT[new Date(n * DAY_MS).getUTCMonth()]}`, title: `Semaine ${isoWeek(n)} — du ${fmtDay(n)} au ${fmtDay(n + 6)}` }),
      ),
    };
  }
  return {
    upper,
    lower: cut(
      range,
      range.start,
      (n) => n + 1,
      (n) => String(new Date(n * DAY_MS).getUTCDate()),
      (n) => ({ sub: WD_INITIAL[weekday(n)], title: fmtDay(n) }),
    ),
  };
}

/** Week-ends (samedi → dimanche) dans la plage. */
export function weekends(range: Span): Span[] {
  const out: Span[] = [];
  for (let sat = mondayOf(range.start) + 5; sat <= range.end; sat += 7) {
    const s = Math.max(sat, range.start);
    const e = Math.min(sat + 1, range.end);
    if (s <= e) out.push({ start: s, end: e });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Liens de dépendance (fin → début)
// ---------------------------------------------------------------------------

export type Pt = [number, number];
export type Link = { from: string; to: string; conflict: boolean; around: boolean; points: Pt[]; d: string };

/**
 * Tracé orthogonal d'un lien fin → début, du milieu du bord droit du
 * prérequis (x1, y1) au milieu du bord gauche de la tâche (x0, y2) :
 *  - direct si la tâche commence assez loin à droite : à droite de `gap`,
 *    vertical jusqu'à la ligne de la tâche, puis horizontal jusqu'à elle ;
 *  - sinon (tâche collée ou en conflit) : contournement par l'intervalle
 *    entre les deux lignes, en revenant `gap` à gauche du début de la tâche.
 */
export function routeLink(x1: number, y1: number, x0: number, y2: number, rowH = ROW_H, gap = LINK_GAP): { points: Pt[]; around: boolean } {
  if (x0 - x1 >= 2 * gap) {
    return { around: false, points: [[x1, y1], [x1 + gap, y1], [x1 + gap, y2], [x0, y2]] };
  }
  const midY = y2 > y1 ? y2 - rowH / 2 : y2 + rowH / 2;
  return {
    around: true,
    points: [[x1, y1], [x1 + gap, y1], [x1 + gap, midY], [x0 - gap, midY], [x0 - gap, y2], [x0, y2]],
  };
}

/** Chemin SVG d'une polyligne orthogonale aux coins arrondis. */
export function roundedPath(points: Pt[], r = 4): string {
  // Supprime les points confondus et les points intermédiaires alignés.
  const pts: Pt[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = last;
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) pts.pop();
    }
    pts.push(p);
  }
  if (!pts.length) return "";
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * rr;
    const ay = cy - ((cy - py) / inLen) * rr;
    const bx = cx + ((nx - cx) / outLen) * rr;
    const by = cy + ((ny - cy) / outLen) * rr;
    d += ` L${f(ax)},${f(ay)} Q${f(cx)},${f(cy)} ${f(bx)},${f(by)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${f(last[0])},${f(last[1])}`;
}

/**
 * Liens entre lignes visibles. `xOf(jour)` = abscisse du début du jour ;
 * `rowIndex` = index de ligne des tâches visibles.
 */
export function buildLinks(
  tasks: GTask[],
  spans: Map<string, Span>,
  rowIndex: Map<string, number>,
  xOf: (day: number) => number,
  rowH = ROW_H,
): Link[] {
  const out: Link[] = [];
  for (const t of tasks) {
    const me = spans.get(t.id);
    const ri = rowIndex.get(t.id);
    if (!me || ri === undefined) continue;
    for (const pid of t.prerequisiteIds ?? []) {
      const p = spans.get(pid);
      const pi = rowIndex.get(pid);
      if (!p || pi === undefined) continue;
      const x1 = xOf(p.end + 1);
      const x0 = xOf(me.start);
      const y1 = pi * rowH + rowH / 2;
      const y2 = ri * rowH + rowH / 2;
      const { points, around } = routeLink(x1, y1, x0, y2, rowH);
      out.push({ from: pid, to: t.id, conflict: isConflict(p, me), around, points, d: roundedPath(points) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning de référence (baseline) : étendues figées et glissements
// ---------------------------------------------------------------------------

type BaselineInput = {
  stages: { id: string; name: string; startDate: string | null; dueDate: string | null }[];
  tasks: { id: string; name: string; stageId: string | null; startDate: string | null; dueDate: string | null }[];
};

/** Étendues figées par clé de ligne du Gantt (`id` de tâche, `stage:<id>`). */
export function baselineSpans(data: BaselineInput): Map<string, Span> {
  const m = new Map<string, Span>();
  const byStage = new Map<string, Span[]>();
  for (const t of data.tasks) {
    const s = taskSpan(t);
    if (!s) continue;
    m.set(t.id, s);
    if (t.stageId) byStage.set(t.stageId, [...(byStage.get(t.stageId) ?? []), s]);
  }
  for (const st of data.stages) {
    const s = stageSpan(st, byStage.get(st.id) ?? []);
    if (s) m.set(`stage:${st.id}`, s);
  }
  return m;
}

/** Glissement en jours de la fin (positif = retard sur la référence) ; null si l'une des deux manque. */
export function slipDays(current: Span | null | undefined, base: Span | null | undefined): number | null {
  return current && base ? current.end - base.end : null;
}

export type StageSlip = { id: string; name: string; base: Span | null; current: Span | null; slip: number | null; startSlip: number | null };

/**
 * Glissement de chaque étape actuelle par rapport à la référence (fin et
 * début), dans l'ordre du plan ; une étape absente de la référence a
 * `base: null`.
 */
export function stageSlips(project: GProject, base: Map<string, Span>): StageSlip[] {
  return project.stages.map((s) => {
    const spans = [...s.activities.flatMap((a) => a.tasks), ...s.tasks].map(taskSpan).filter((x): x is Span => !!x);
    const current = stageSpan(s, spans);
    const b = base.get(`stage:${s.id}`) ?? null;
    return { id: s.id, name: s.name, base: b, current, slip: slipDays(current, b), startSlip: current && b ? current.start - b.start : null };
  });
}

/** Écart global entre référence et réel : tâches ajoutées, retirées, en retard / en avance sur la référence. */
export function baselineSummary(project: GProject, data: BaselineInput, base: Map<string, Span>) {
  const tasks = [...project.stages.flatMap((s) => [...s.activities.flatMap((a) => a.tasks), ...s.tasks]), ...project.tasks];
  const ids = new Set(tasks.map((t) => t.id));
  let late = 0;
  let early = 0;
  let maxSlip = 0;
  for (const t of tasks) {
    const d = slipDays(taskSpan(t), base.get(t.id));
    if (d === null) continue;
    if (d > 0) late++;
    if (d < 0) early++;
    maxSlip = Math.max(maxSlip, d);
  }
  const added = tasks.filter((t) => taskSpan(t) && !base.has(t.id)).length;
  const removed = data.tasks.filter((t) => !ids.has(t.id)).length;
  const end = unionSpan(tasks.map(taskSpan));
  const baseEnd = unionSpan(data.tasks.map(taskSpan));
  return { late, early, maxSlip, added, removed, projectSlip: slipDays(end, baseEnd) };
}

/** Libellé court d'un glissement : « +3 j », « −2 j », « = ». */
export function fmtSlip(d: number): string {
  return d === 0 ? "=" : `${d > 0 ? "+" : "−"}${Math.abs(d)} j`;
}
