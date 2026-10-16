import "server-only";
import { allCustomFields } from "@/lib/custom-fields";
import { customEntries } from "@/lib/shared/custom-fields";
import ExcelJS from "exceljs";
import { getProject, type ProjectDto, type TaskDto } from "@/lib/projects";
import { listRisks, type RiskDto } from "@/lib/risks";
import { listMeetings, type MeetingDto } from "@/lib/meetings";
import { htmlToText } from "@/lib/sanitize";
import { prisma } from "@/lib/prisma";
import { strategyLabel, RISK_STATUS_LABEL, PROBABILITY_LABELS, SEVERITY_LABELS, BENEFIT_LABELS, riskLevel, levelLabel, type RiskLevel } from "@/lib/shared/risks";

/**
 * Export Excel complet d'un projet (bouton « Export Excel » de la fiche
 * projet), mis en forme comme un livrable : Synthèse (bandeau aux couleurs du
 * projet, indicateurs en cartes, répartitions, avancement par étape, sommaire
 * avec liens), Tâches, Planning (Gantt hebdomadaire ou mensuel par mise en
 * forme conditionnelle), Étapes & activités, Livrables, Risques &
 * opportunités, Matrices, Réunions, Équipe et Documents.
 *
 * Chaque feuille-tableau : titre, sous-titre, en-tête à la couleur du projet,
 * lignes alternées, bordures fines, volets figés, filtre automatique, formats
 * typés (dates, pourcentages avec barres de données), statuts et priorités en
 * pastilles colorées, mise en page d'impression (paysage, ajusté en largeur,
 * en-tête répété). Mêmes droits que la lecture du projet.
 *
 * Rendu en une passe, sans formule coûteuse : les styles sont partagés (mémo)
 * et le Gantt n'écrit aucune cellule de calendrier (mise en forme
 * conditionnelle uniquement) — quelques secondes au plus pour 4 000 tâches.
 */

const STATUS: Record<string, string> = { TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CLOSED: "Clôturée" };
const PRIORITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Haute", CRITICAL: "Critique" };
const COMPLEXITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Forte" };
const PROJECT_STATUS: Record<string, string> = { ACTIVE: "Actif", ON_HOLD: "En pause", DONE: "Terminé", ARCHIVED: "Archivé" };
const DELIVERABLE_STATUS: Record<string, string> = { PLANNED: "Prévu", IN_PROGRESS: "En cours", DELIVERED: "Livré", VALIDATED: "Validé" };
const MEETING_STATUS: Record<string, string> = { draft: "Brouillon", no_review: "Sans validation", pending: "En validation", approved: "Validé", rejected: "Refusé" };
const DECISION: Record<string, string> = { PENDING: "en attente", APPROVED: "validé", REJECTED: "refusé" };

// --- Couleurs ----------------------------------------------------------------

/** Pastilles : [fond, texte] (hex sans #). */
type Tone = "grey" | "blue" | "green" | "violet" | "red" | "orange" | "amber" | "teal";
const TONES: Record<Tone, [string, string]> = {
  grey: ["EEF0F3", "4B5563"],
  blue: ["DBEAFE", "1E40AF"],
  green: ["D1FAE5", "065F46"],
  violet: ["EDE9FE", "5B21B6"],
  red: ["FEE2E2", "991B1B"],
  orange: ["FFEDD5", "9A3412"],
  amber: ["FEF3C7", "92400E"],
  teal: ["CCFBF1", "115E59"],
};
const STATUS_TONE: Record<string, Tone> = { TODO: "grey", IN_PROGRESS: "blue", DONE: "green", CLOSED: "violet" };
const PRIORITY_TONE: Record<string, Tone> = { LOW: "grey", MEDIUM: "blue", HIGH: "orange", CRITICAL: "red" };
const COMPLEXITY_TONE: Record<string, Tone> = { LOW: "grey", MEDIUM: "amber", HIGH: "orange" };
const DELIVERABLE_TONE: Record<string, Tone> = { PLANNED: "grey", IN_PROGRESS: "blue", DELIVERED: "teal", VALIDATED: "green" };
const MEETING_TONE: Record<string, Tone> = { draft: "grey", no_review: "grey", pending: "amber", approved: "green", rejected: "red" };
const RISK_STATUS_TONE: Record<string, Tone> = { OPEN: "orange", MONITORING: "amber", TREATED: "blue", CLOSED: "grey" };
/** Libellé affiché → teinte (les colonnes contiennent des libellés). */
const byLabel = (labels: Record<string, string>, tones: Record<string, Tone>): Record<string, Tone> =>
  Object.fromEntries(Object.entries(labels).map(([k, l]) => [l, tones[k] ?? "grey"]));

/** Couleurs de niveau (risques : vert → rouge ; opportunités : clair → foncé) : [fond, texte]. */
const RISK_FILL: Record<RiskLevel, [string, string]> = { low: ["C6EFCE", "14532D"], medium: ["FFEB9C", "713F12"], high: ["F8CBAD", "7C2D12"], critical: ["FF7C80", "7F1D1D"] };
const OPP_FILL: Record<RiskLevel, [string, string]> = { low: ["DDF2F0", "134E4A"], medium: ["A8DDD5", "134E4A"], high: ["5FBFB0", "FFFFFF"], critical: ["2A9D8F", "FFFFFF"] };
const LEVELS_DESC: RiskLevel[] = ["critical", "high", "medium", "low"];

const DEFAULT_BRAND = "4F5FF0";
const TEXT = "1F2937";
const MUTED = "6B7280";
const LINE = "E3E6EC";
const WHITE = "FFFFFF";
const RED = "DC2626";
const GREEN = "059669";
const FONT = "Calibri";

const argb = (h: string) => ({ argb: `FF${h}` });
const solid = (h: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: argb(h), bgColor: argb(h) });
const font = (size: number, color: string, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: FONT, size, color: argb(color), ...extra });
const thin = (h: string): Partial<ExcelJS.Border> => ({ style: "thin", color: argb(h) });
const GRID: Partial<ExcelJS.Borders> = { top: thin(LINE), bottom: thin(LINE), left: thin(LINE), right: thin(LINE) };

function parseHex(c: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Mélange `a` et `b` (t = part de b). */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type Theme = { brand: string; ink: string; tint: string; band: string; soft: string; onBrand: string; onBrandSub: string; headLine: string };
function makeTheme(color: string | null): Theme {
  const brand = parseHex(color) ?? DEFAULT_BRAND;
  const light = luminance(brand) > 0.45;
  return {
    brand,
    ink: mix(brand, "111827", light ? 0.7 : 0.35),
    tint: mix(brand, WHITE, 0.9),
    band: mix(brand, WHITE, 0.955),
    soft: mix(brand, WHITE, 0.55),
    onBrand: light ? "111827" : WHITE,
    onBrandSub: light ? "374151" : mix(brand, WHITE, 0.78),
    headLine: mix(brand, WHITE, 0.3),
  };
}

// --- Utilitaires --------------------------------------------------------------

const day = (iso: string | null | undefined): Date | null => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);
const text = (html: string | null | undefined, max = 32_000) => (html ? htmlToText(html, max) : "");
const DAY_MS = 86_400_000;
const nf = new Intl.NumberFormat("fr-FR");
const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "");
const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n > 1 ? many : one}`;

/** Lignes estimées d'un texte replié dans une colonne de largeur `width` (police 10). */
function lineCount(v: unknown, width: number): number {
  if (typeof v !== "string" || !v) return 1;
  const perLine = Math.max(4, Math.floor(width * 1.15));
  let n = 0;
  for (const part of v.split("\n")) {
    n += Math.max(1, Math.ceil(part.length / perLine));
    if (n > 40) break;
  }
  return n;
}

function allTasks(p: ProjectDto): Array<{ task: TaskDto; stage: string; activity: string }> {
  const out: Array<{ task: TaskDto; stage: string; activity: string }> = [];
  for (const s of p.stages) {
    for (const a of s.activities) for (const t of a.tasks) out.push({ task: t, stage: s.name, activity: a.name });
    for (const t of s.tasks) out.push({ task: t, stage: s.name, activity: "" });
  }
  for (const t of p.tasks) out.push({ task: t, stage: "", activity: "" });
  return out;
}

const isClosed = (t: TaskDto) => t.status === "DONE" || t.status === "CLOSED";
const isLate = (t: TaskDto, today: string) => !!t.dueDate && t.dueDate.slice(0, 10) < today && !isClosed(t);

// --- Feuilles -----------------------------------------------------------------

type Ctx = { wb: ExcelJS.Workbook; theme: Theme; project: string; stamp: string };
/** Ligne d'en-tête des feuilles-tableaux (titre, sous-titre, espace, en-tête). */
const HEAD = 4;

function newSheet(ctx: Ctx, name: string, opts: { portrait?: boolean; xSplit?: number; ySplit?: number; grid?: boolean; tab?: string } = {}) {
  const xSplit = opts.xSplit ?? 0;
  const ySplit = opts.ySplit ?? HEAD;
  const footerName = ctx.project.replace(/&/g, "&&");
  return ctx.wb.addWorksheet(name, {
    properties: { tabColor: argb(opts.tab ?? ctx.theme.brand) },
    views: [
      xSplit || ySplit
        ? { state: "frozen", xSplit, ySplit, showGridLines: !!opts.grid, zoomScale: 100 }
        : { state: "normal", showGridLines: !!opts.grid, zoomScale: 100 },
    ],
    pageSetup: {
      paperSize: 9,
      orientation: opts.portrait ? "portrait" : "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.55, header: 0.25, footer: 0.25 },
      ...(ySplit === HEAD ? { printTitlesRow: `${HEAD}:${HEAD}` } : {}),
    },
    headerFooter: { oddFooter: `&L&8${footerName}&C&8&A&R&8Page &P / &N` },
  });
}

/** Écrit `value` dans la plage (ligne, c1..c2) fusionnée, avec un style commun. */
function put(ws: ExcelJS.Worksheet, row: number, c1: number, c2: number, value: ExcelJS.CellValue, style: Partial<ExcelJS.Style>) {
  for (let c = c1; c <= c2; c++) ws.getCell(row, c).style = style;
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  cell.value = value;
  return cell;
}
/** Remplace le style d'une cellule (les styles sont partagés : jamais de mutation). */
const restyle = (cell: ExcelJS.Cell, patch: Partial<ExcelJS.Style>) => {
  cell.style = { ...cell.style, ...patch };
};

function sheetTitle(ctx: Ctx, ws: ExcelJS.Worksheet, title: string, ncols: number, info: string) {
  const span = Math.max(ncols, 6);
  put(ws, 1, 1, span, title, { font: font(18, ctx.theme.ink, { bold: true }), alignment: { vertical: "middle" } });
  ws.getRow(1).height = 34;
  put(ws, 2, 1, span, `${ctx.project}   •   ${info}   •   Export du ${ctx.stamp}`, { font: font(10, MUTED), alignment: { vertical: "top" } });
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 8;
}

function dataBar(ws: ExcelJS.Worksheet, ref: string, color: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "dataBar",
        priority: 1,
        gradient: false,
        border: false,
        minLength: 0,
        maxLength: 100,
        cfvo: [
          { type: "num", value: 0 },
          { type: "num", value: 1 },
        ],
        color: argb(color),
      } as ExcelJS.DataBarRuleType,
    ],
  });
}

type ColType = "text" | "center" | "ref" | "date" | "datetime" | "int" | "size" | "pct";
type Col = { header: string; key: string; width: number; type?: ColType; wrap?: boolean; pill?: Record<string, Tone> };
const NUMFMT: Partial<Record<ColType, string>> = { date: "dd/mm/yyyy", datetime: "dd/mm/yyyy hh:mm", int: "#,##0", size: "#,##0", pct: "0%" };
const ALIGN: Record<ColType, ExcelJS.Alignment["horizontal"]> = { text: "left", center: "center", ref: "center", date: "center", datetime: "center", int: "center", size: "right", pct: "center" };

type Decorate<T> = (cell: (key: string) => ExcelJS.Cell, item: T, multi: boolean) => void;

/**
 * Feuille-tableau : titre, en-tête stylé, lignes alternées, pastilles, barres
 * de données sur les pourcentages, filtre, volets figés, impression.
 */
function dataSheet<T>(
  ctx: Ctx,
  name: string,
  opts: { title?: string; info?: (n: number) => string; xSplit?: number; zebra?: boolean; maxHeight?: number; tab?: string },
  cols: Col[],
  items: T[],
  toRow: (item: T) => Record<string, unknown>,
  decorate?: Decorate<T>,
) {
  const { theme } = ctx;
  const ws = newSheet(ctx, name, { xSplit: opts.xSplit, tab: opts.tab });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  sheetTitle(ctx, ws, opts.title ?? name, cols.length, opts.info ? opts.info(items.length) : plural(items.length, "élément"));

  const head = ws.getRow(HEAD);
  head.height = 32;
  const headStyle: Partial<ExcelJS.Style> = {
    font: font(10, theme.onBrand, { bold: true }),
    fill: solid(theme.brand),
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: { left: thin(theme.headLine), right: thin(theme.headLine), bottom: { style: "medium", color: argb(theme.ink) } },
  };
  cols.forEach((c, j) => {
    const cell = head.getCell(j + 1);
    cell.value = c.header;
    cell.style = headStyle;
  });

  // Styles mémoïsés par (colonne, bande, multi-ligne, pastille).
  const memo = new Map<string, Partial<ExcelJS.Style>>();
  const styleOf = (j: number, band: boolean, multi: boolean, tone?: Tone): Partial<ExcelJS.Style> => {
    const k = `${j}|${band ? 1 : 0}|${multi ? 1 : 0}|${tone ?? ""}`;
    let s = memo.get(k);
    if (!s) {
      const c = cols[j];
      const type = c.type ?? "text";
      const numFmt = NUMFMT[type];
      s = {
        font: tone ? font(10, TONES[tone][1], { bold: true }) : type === "ref" ? font(10, theme.ink, { bold: true }) : font(10, TEXT),
        alignment: { horizontal: tone ? "center" : ALIGN[type], vertical: multi ? "top" : "middle", wrapText: !!c.wrap },
        border: GRID,
        ...(tone ? { fill: solid(TONES[tone][0]) } : band ? { fill: solid(theme.band) } : {}),
        ...(numFmt ? { numFmt } : {}),
      };
      memo.set(k, s);
    }
    return s;
  };

  const zebra = opts.zebra !== false;
  const maxHeight = opts.maxHeight ?? 120;
  const keyIndex = new Map(cols.map((c, j) => [c.key, j + 1]));
  items.forEach((item, i) => {
    const values = toRow(item);
    const row = ws.getRow(HEAD + 1 + i);
    let lines = 1;
    for (const c of cols) if (c.wrap) lines = Math.max(lines, lineCount(values[c.key], c.width));
    const multi = lines > 1;
    row.height = multi ? Math.min(maxHeight, lines * 13 + 6) : 18;
    const band = zebra && i % 2 === 1;
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const v = values[c.key];
      if (v !== null && v !== undefined && v !== "") cell.value = v as ExcelJS.CellValue;
      const tone = c.pill && typeof v === "string" ? c.pill[v] : undefined;
      cell.style = styleOf(j, band, multi, tone);
    });
    decorate?.((key) => row.getCell(keyIndex.get(key)!), item, multi);
  });

  const last = HEAD + items.length;
  if (items.length) {
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: cols.length } };
    cols.forEach((c, j) => {
      if (c.type === "pct") dataBar(ws, `${ws.getColumn(j + 1).letter}${HEAD + 1}:${ws.getColumn(j + 1).letter}${last}`, theme.soft);
    });
  } else {
    put(ws, HEAD + 1, 1, cols.length, "Aucun élément à afficher.", { font: font(10, MUTED, { italic: true }), alignment: { horizontal: "center", vertical: "middle" }, border: GRID });
    ws.getRow(HEAD + 1).height = 26;
  }
  return ws;
}

// --- Planning (Gantt par mise en forme conditionnelle) ------------------------

function planningSheet(ctx: Ctx, tasks: Array<{ task: TaskDto; stage: string }>, taskRef: Map<string, string>, assigneeOf: (t: TaskDto) => string, now: Date) {
  const { theme } = ctx;
  const fixed: Col[] = [
    { header: "Réf.", key: "ref", width: 7, type: "ref" },
    { header: "Tâche", key: "name", width: 38 },
    { header: "Étape", key: "stage", width: 18 },
    { header: "Responsable", key: "assignee", width: 16 },
    { header: "Statut", key: "status", width: 11, pill: byLabel(STATUS, STATUS_TONE) },
    { header: "Début", key: "start", width: 10.5, type: "date" },
    { header: "Échéance", key: "due", width: 10.5, type: "date" },
  ];
  const dated = tasks
    .map(({ task, stage }) => {
      let s = day(task.startDate ?? task.dueDate);
      let e = day(task.dueDate ?? task.startDate);
      if (s && e && s > e) [s, e] = [e, s];
      return { task, stage, s, e };
    })
    .filter((x): x is { task: TaskDto; stage: string; s: Date; e: Date } => !!x.s && !!x.e);

  // Granularité : semaines (≤ 78) sinon mois (≤ 120).
  let min = Infinity;
  let max = -Infinity;
  for (const { s, e } of dated) {
    if (s.getTime() < min) min = s.getTime();
    if (e.getTime() > max) max = e.getTime();
  }
  const buckets: Date[] = [];
  let weekly = true;
  if (dated.length) {
    const first = new Date(min);
    const monday = new Date(min - ((first.getUTCDay() + 6) % 7) * DAY_MS);
    const weeks = Math.floor((max - monday.getTime()) / (7 * DAY_MS)) + 1;
    if (weeks <= 78) {
      for (let w = 0; w < weeks; w++) buckets.push(new Date(monday.getTime() + w * 7 * DAY_MS));
    } else {
      weekly = false;
      const last = new Date(max);
      const months = Math.min(120, (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1);
      for (let m = 0; m < months; m++) buckets.push(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m, 1)));
    }
  }

  const ws = dataSheet(
    ctx,
    "Planning",
    {
      title: "Planning",
      info: (n) => `${plural(n, "tâche datée", "tâches datées")} • vue ${weekly ? "hebdomadaire" : "mensuelle"}`,
      xSplit: 2,
    },
    fixed,
    dated,
    ({ task, stage, s, e }) => ({ ref: taskRef.get(task.id), name: task.name, stage, assignee: assigneeOf(task), status: STATUS[task.status], start: s, due: e }),
  );
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: HEAD, showGridLines: true, zoomScale: 100 }];
  if (!dated.length) return ws;

  const c0 = fixed.length + 1;
  const cN = c0 + buckets.length - 1;
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const bucketEnd = (d: Date) => (weekly ? d.getTime() + 7 * DAY_MS : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const headStyle: Partial<ExcelJS.Style> = {
    font: font(8, theme.onBrand, { bold: true }),
    fill: solid(theme.brand),
    alignment: { horizontal: "center", vertical: "middle", textRotation: 90 },
    border: { left: thin(theme.headLine), right: thin(theme.headLine), bottom: { style: "medium", color: argb(theme.ink) } },
    numFmt: weekly ? "dd/mm" : "mmm yy",
  };
  const nowStyle: Partial<ExcelJS.Style> = { ...headStyle, fill: solid("F59E0B"), font: font(8, "111827", { bold: true }) };
  buckets.forEach((d, i) => {
    ws.getColumn(c0 + i).width = weekly ? 3.6 : 5.5;
    const cell = ws.getCell(HEAD, c0 + i);
    cell.value = d;
    cell.style = todayMs >= d.getTime() && todayMs < bucketEnd(d) ? nowStyle : headStyle;
  });
  ws.getRow(HEAD).height = 44;

  // Bandeau des mois (hebdomadaire) ou des années (mensuel) au-dessus.
  ws.getRow(3).height = 18;
  const bandStyle: Partial<ExcelJS.Style> = { font: font(9, theme.ink, { bold: true }), fill: solid(theme.tint), alignment: { horizontal: "center", vertical: "middle" }, border: { left: thin(WHITE), right: thin(WHITE) } };
  const groupOf = (d: Date) => (weekly ? d.toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }) : String(d.getUTCFullYear()));
  let from = 0;
  for (let i = 1; i <= buckets.length; i++) {
    if (i === buckets.length || groupOf(buckets[i]) !== groupOf(buckets[from])) {
      put(ws, 3, c0 + from, c0 + i - 1, i - from >= (weekly ? 2 : 1) ? groupOf(buckets[from]) : "", bandStyle);
      from = i;
    }
  }

  // Barres : une règle par état, sans écrire les cellules du calendrier.
  const L = (c: number) => ws.getColumn(c).letter;
  const first = `${L(c0)}$${HEAD}`;
  const r = HEAD + 1;
  const sCol = `$${L(6)}${r}`;
  const eCol = `$${L(7)}${r}`;
  const st = `$${L(5)}${r}`;
  const end = weekly ? `${first}+6` : `EOMONTH(${first},0)`;
  const inBar = `AND(${sCol}<=${end},${eCol}>=${first})`;
  const fill = (h: string): Partial<ExcelJS.Style> => ({ fill: { type: "pattern", pattern: "solid", fgColor: argb(h), bgColor: argb(h) } });
  ws.addConditionalFormatting({
    ref: `${L(c0)}${r}:${L(cN)}${HEAD + dated.length}`,
    rules: [
      { type: "expression", priority: 1, formulae: [`AND(${inBar},OR(${st}="${STATUS.DONE}",${st}="${STATUS.CLOSED}"))`], style: fill("34B27B") },
      { type: "expression", priority: 2, formulae: [`AND(${inBar},${eCol}<TODAY())`], style: fill("E5484D") },
      { type: "expression", priority: 3, formulae: [`AND(${inBar},${st}="${STATUS.IN_PROGRESS}")`], style: fill(theme.brand) },
      { type: "expression", priority: 4, formulae: [inBar], style: fill(theme.soft) },
      { type: "expression", priority: 5, formulae: [`AND(TODAY()>=${first},TODAY()<=${end})`], style: fill("FDF0C4") },
    ],
  });
  return ws;
}

// --- Synthèse -----------------------------------------------------------------

type CountRow = { label: string; count: number; colors: [string, string] };

function summarySheet(
  ctx: Ctx,
  d: {
    project: ProjectDto;
    owner: string;
    tasks: Array<{ task: TaskDto; stage: string; activity: string }>;
    today: string;
    risks: RiskDto[];
    meetings: MeetingDto[];
    contents: Array<{ sheet: string; about: string; count: string }>;
    /** Champs personnalisés renseignés (Administration → Champs personnalisés). */
    infos?: Array<{ label: string; value: string }>;
  },
) {
  const { theme } = ctx;
  const { project, tasks, risks, meetings } = d;
  const ws = newSheet(ctx, "Synthèse", { portrait: true, ySplit: 0 });
  const B = 2;
  const M = 13;
  ws.columns = [{ width: 2.5 }, ...Array.from({ length: 12 }, () => ({ width: 12.5 })), { width: 2.5 }];

  // Bandeau.
  const banner = solid(theme.brand);
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 14; c++) ws.getCell(r, c).style = { fill: banner };
  [10, 44, 22, 18, 12].forEach((h, i) => (ws.getRow(i + 1).height = h));
  put(ws, 2, B, M, project.name, { fill: banner, font: font(24, theme.onBrand, { bold: true }), alignment: { vertical: "middle" } });
  const dates = project.startDate || project.dueDate ? `${fmtDay(day(project.startDate)) || "…"} → ${fmtDay(day(project.dueDate)) || "…"}` : "Dates non définies";
  const sub = [`Statut : ${PROJECT_STATUS[project.status] ?? project.status}`, `Propriétaire : ${d.owner || "—"}`, dates, plural(project.members.length, "membre")].join("   •   ");
  put(ws, 3, B, M, sub, { fill: banner, font: font(11, theme.onBrandSub), alignment: { vertical: "middle" } });
  put(ws, 4, B, M, `Export du ${ctx.stamp} — Second Brain`, { fill: banner, font: font(9, theme.onBrandSub, { italic: true }), alignment: { vertical: "top" } });

  let row = 7;
  const section = (title: string) => {
    put(ws, row, B, M, title, { font: font(13, theme.ink, { bold: true }), alignment: { vertical: "bottom" }, border: { bottom: { style: "medium", color: argb(theme.brand) } } });
    ws.getRow(row).height = 24;
    ws.getRow(row + 1).height = 8;
    row += 2;
  };

  // Indicateurs.
  const total = tasks.length;
  const done = tasks.filter(({ task }) => isClosed(task)).length;
  const late = tasks.filter(({ task }) => isLate(task, d.today)).length;
  const open = total - done;
  const openRisks = risks.filter((k) => k.kind === "RISK" && k.status !== "CLOSED");
  const severe = openRisks.filter((k) => k.level === "high" || k.level === "critical").length;
  const opportunities = risks.filter((k) => k.kind === "OPPORTUNITY");
  const delivered = project.deliverables.filter((x) => x.status === "DELIVERED" || x.status === "VALIDATED").length;
  const pendingMeetings = meetings.filter((m) => m.status === "pending").length;

  type Card = { label: string; value: number; fmt?: string; caption: string; accent: string; color?: string };
  const card = (top: number, c1: number, k: Card) => {
    const c2 = c1 + 2;
    const edge = { left: { style: "thick" as const, color: argb(WHITE) }, right: { style: "thick" as const, color: argb(WHITE) } };
    const base: Partial<ExcelJS.Style> = { fill: solid(theme.tint), alignment: { horizontal: "left", vertical: "middle", indent: 1 } };
    put(ws, top, c1, c2, k.label.toUpperCase(), { ...base, font: font(9, MUTED, { bold: true }), alignment: { ...base.alignment, vertical: "bottom" }, border: { ...edge, top: { style: "thick", color: argb(k.accent) } } });
    put(ws, top + 1, c1, c2, k.value, { ...base, font: font(26, k.color ?? theme.ink, { bold: true }), numFmt: k.fmt ?? "#,##0", border: edge });
    put(ws, top + 2, c1, c2, k.caption, { ...base, font: font(9, MUTED), alignment: { ...base.alignment, vertical: "top" }, border: edge });
  };
  const cards = (list: Card[]) => {
    ws.getRow(row).height = 22;
    ws.getRow(row + 1).height = 40;
    ws.getRow(row + 2).height = 22;
    list.forEach((k, i) => card(row, B + i * 3, k));
    ws.getRow(row + 3).height = 10;
    row += 4;
  };

  section("Indicateurs clés");
  cards([
    { label: "Avancement", value: project.progress.percent / 100, fmt: "0%", caption: `moyenne des ${plural(total, "tâche")}`, accent: theme.brand },
    { label: "Tâches", value: total, caption: `${nf.format(open)} ouvertes • ${plural(project.stages.length, "étape")}`, accent: theme.brand },
    { label: "Terminées", value: done, caption: total ? `${Math.round((done / total) * 100)} % des tâches (terminées ou clôturées)` : "aucune tâche", accent: GREEN, color: GREEN },
    { label: "En retard", value: late, caption: late ? `${open ? Math.round((late / open) * 100) : 0} % des tâches ouvertes` : "aucune tâche en retard", accent: RED, color: late ? RED : GREEN },
  ]);
  cards([
    { label: "Livrables", value: project.deliverables.length, caption: `${nf.format(delivered)} livrés ou validés`, accent: "0D9488" },
    { label: "Risques ouverts", value: openRisks.length, caption: `dont ${nf.format(severe)} élevés ou critiques`, accent: "EA580C", color: severe ? "C2410C" : undefined },
    { label: "Opportunités", value: opportunities.length, caption: `${nf.format(opportunities.filter((k) => k.status !== "CLOSED").length)} non closes`, accent: "2A9D8F" },
    { label: "Réunions", value: meetings.length, caption: pendingMeetings ? `${nf.format(pendingMeetings)} en validation` : "aucune en validation", accent: "7C3AED" },
  ]);

  // Barre d'avancement segmentée (10 segments).
  put(ws, row, B, B + 1, "Avancement global", { font: font(10, theme.ink, { bold: true }), alignment: { vertical: "middle" } });
  const pct = project.progress.percent;
  for (let i = 0; i < 10; i++) {
    const filled = pct >= (i + 1) * 10 ? theme.brand : pct > i * 10 + 4 ? theme.soft : "ECEEF2";
    ws.getCell(row, B + 2 + i).style = { fill: solid(filled), border: { left: { style: "thin", color: argb(WHITE) }, right: { style: "thin", color: argb(WHITE) }, top: { style: "thin", color: argb(WHITE) }, bottom: { style: "thin", color: argb(WHITE) } } };
  }
  ws.getRow(row).height = 18;
  row += 2;

  // Répartitions (deux blocs côte à côte).
  const block = (top: number, c1: number, labelSpan: number, barSpan: number, title: string, rows: CountRow[], denominator: number) => {
    const c2 = c1 + labelSpan + barSpan;
    put(ws, top, c1, c2, title, { font: font(10, theme.ink, { bold: true }), alignment: { vertical: "bottom" }, border: { bottom: thin(theme.soft) } });
    rows.forEach((x, i) => {
      const r = top + 1 + i;
      put(ws, r, c1, c1 + labelSpan - 1, x.label, { font: font(10, x.colors[1], { bold: true }), fill: solid(x.colors[0]), alignment: { horizontal: "center", vertical: "middle" }, border: { top: thin(WHITE), bottom: thin(WHITE) } });
      put(ws, r, c1 + labelSpan, c1 + labelSpan, x.count, { font: font(11, TEXT, { bold: true }), numFmt: "#,##0", alignment: { horizontal: "center", vertical: "middle" }, border: { bottom: thin(LINE) } });
      put(ws, r, c1 + labelSpan + 1, c2, denominator ? x.count / denominator : 0, { font: font(9, MUTED), numFmt: "0%", alignment: { horizontal: "right", vertical: "middle" }, border: { bottom: thin(LINE) } });
    });
    const col = ws.getColumn(c1 + labelSpan + 1).letter;
    dataBar(ws, `${col}${top + 1}:${col}${top + rows.length}`, theme.soft);
  };
  const tone = (t: Tone): [string, string] => TONES[t];
  const countBy = <K extends string>(keys: K[], of: (k: K) => number, label: (k: K) => string, colors: (k: K) => [string, string]): CountRow[] =>
    keys.map((k) => ({ label: label(k), count: of(k), colors: colors(k) }));

  section("Répartitions");
  const statusKeys = ["TODO", "IN_PROGRESS", "DONE", "CLOSED"];
  const statusRows = countBy(statusKeys, (k) => tasks.filter(({ task }) => task.status === k).length, (k) => STATUS[k], (k) => tone(STATUS_TONE[k]));
  const riskRows = countBy(LEVELS_DESC, (k) => openRisks.filter((x) => x.level === k).length, (k) => levelLabel("RISK", k), (k) => RISK_FILL[k]);
  for (let i = 0; i <= 4; i++) ws.getRow(row + i).height = 20;
  block(row, B, 2, 3, "Tâches par statut", statusRows, total);
  block(row, B + 7, 2, 2, "Risques ouverts par niveau", riskRows, openRisks.length);
  row += 6;
  const prioKeys = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const prioRows = countBy(prioKeys, (k) => tasks.filter(({ task }) => task.priority === k).length, (k) => PRIORITY[k], (k) => tone(PRIORITY_TONE[k]));
  const delivKeys = ["PLANNED", "IN_PROGRESS", "DELIVERED", "VALIDATED"];
  const delivRows = countBy(delivKeys, (k) => project.deliverables.filter((x) => x.status === k).length, (k) => DELIVERABLE_STATUS[k], (k) => tone(DELIVERABLE_TONE[k]));
  for (let i = 0; i <= 4; i++) ws.getRow(row + i).height = 20;
  block(row, B, 2, 3, "Tâches par priorité", prioRows, total);
  block(row, B + 7, 2, 2, "Livrables par statut", delivRows, project.deliverables.length);
  row += 6;

  // Avancement par étape.
  section(`Avancement par étape (${project.stages.length})`);
  const headStyle: Partial<ExcelJS.Style> = { font: font(10, theme.onBrand, { bold: true }), fill: solid(theme.brand), alignment: { horizontal: "center", vertical: "middle", wrapText: true }, border: { left: thin(theme.headLine), right: thin(theme.headLine) } };
  const heads: Array<[number, number, string]> = [[B, B + 3, "Étape"], [B + 4, B + 4, "Début"], [B + 5, B + 5, "Échéance"], [B + 6, B + 6, "Tâches"], [B + 7, B + 7, "Terminées"], [B + 8, B + 8, "En retard"], [B + 9, M, "Avancement"]];
  for (const [a, b, label] of heads) put(ws, row, a, b, label, headStyle);
  ws.getRow(row).height = 24;
  row++;
  type StageLine = { name: string; start: Date | null; due: Date | null; tasks: TaskDto[]; percent: number };
  const lines: StageLine[] = project.stages.map((s) => ({
    name: s.name,
    start: day(s.startDate),
    due: day(s.dueDate),
    tasks: [...s.activities.flatMap((a) => a.tasks), ...s.tasks],
    percent: s.progress.percent,
  }));
  if (project.tasks.length) {
    lines.push({ name: "(Tâches sans étape)", start: null, due: null, tasks: project.tasks, percent: Math.round(project.tasks.reduce((a, t) => a + t.progress, 0) / project.tasks.length) });
  }
  const firstStage = row;
  lines.forEach((s, i) => {
    const band = i % 2 === 1 ? { fill: solid(theme.band) } : {};
    const cellStyle = (h: ExcelJS.Alignment["horizontal"], extra: Partial<ExcelJS.Style> = {}): Partial<ExcelJS.Style> => ({ font: font(10, TEXT), alignment: { horizontal: h, vertical: "middle", indent: h === "left" ? 1 : 0 }, border: { bottom: thin(LINE) }, ...band, ...extra });
    const lateCount = s.tasks.filter((t) => isLate(t, d.today)).length;
    put(ws, row, B, B + 3, s.name, cellStyle("left", { font: font(10, TEXT, { bold: true }) }));
    put(ws, row, B + 4, B + 4, s.start, cellStyle("center", { numFmt: "dd/mm/yyyy" }));
    put(ws, row, B + 5, B + 5, s.due, cellStyle("center", { numFmt: "dd/mm/yyyy" }));
    put(ws, row, B + 6, B + 6, s.tasks.length, cellStyle("center", { numFmt: "#,##0" }));
    put(ws, row, B + 7, B + 7, s.tasks.filter(isClosed).length, cellStyle("center", { numFmt: "#,##0" }));
    put(ws, row, B + 8, B + 8, lateCount, cellStyle("center", { numFmt: "#,##0", font: lateCount ? font(10, RED, { bold: true }) : font(10, MUTED) }));
    put(ws, row, B + 9, M, s.percent / 100, cellStyle("right", { numFmt: "0%", font: font(10, theme.ink, { bold: true }) }));
    ws.getRow(row).height = 20;
    row++;
  });
  if (!lines.length) {
    put(ws, row, B, M, "Aucune étape.", { font: font(10, MUTED, { italic: true }), alignment: { horizontal: "center" } });
    row++;
  } else {
    const col = ws.getColumn(B + 9).letter;
    dataBar(ws, `${col}${firstStage}:${col}${row - 1}`, theme.soft);
  }
  row++;

  // Sommaire avec liens.
  section("Contenu du classeur");
  d.contents.forEach((x, i) => {
    const band = i % 2 === 1 ? { fill: solid(theme.band) } : {};
    put(ws, row, B, B + 2, { formula: `HYPERLINK("#'${x.sheet}'!A1","${x.sheet}")`, result: x.sheet } as ExcelJS.CellFormulaValue, {
      font: font(10, theme.brand, { bold: true, underline: true }),
      alignment: { vertical: "middle", indent: 1 },
      border: { bottom: thin(LINE) },
      ...band,
    });
    put(ws, row, B + 3, B + 9, x.about, { font: font(10, MUTED), alignment: { vertical: "middle" }, border: { bottom: thin(LINE) }, ...band });
    put(ws, row, B + 10, M, x.count, { font: font(10, TEXT), alignment: { horizontal: "right", vertical: "middle", indent: 1 }, border: { bottom: thin(LINE) }, ...band });
    ws.getRow(row).height = 20;
    row++;
  });
  row++;

  // Champs personnalisés (« Client », « Code analytique »…).
  if (d.infos?.length) {
    section("Informations");
    d.infos.forEach((x, i) => {
      const band = i % 2 === 1 ? { fill: solid(theme.band) } : {};
      put(ws, row, B, B + 2, x.label, { font: font(10, MUTED, { bold: true }), alignment: { vertical: "middle", indent: 1 }, border: { bottom: thin(LINE) }, ...band });
      put(ws, row, B + 3, M, x.value, { font: font(10, TEXT), alignment: { vertical: "middle", wrapText: true }, border: { bottom: thin(LINE) }, ...band });
      ws.getRow(row).height = Math.max(20, lineCount(x.value, 110) * 14 + 6);
      row++;
    });
    row++;
  }

  // Description et notes.
  const prose = (title: string, body: string) => {
    if (!body.trim()) return;
    section(title);
    const height = Math.min(409, lineCount(body, 150) * 14 + 8);
    put(ws, row, B, M, body, { font: font(10, TEXT), alignment: { wrapText: true, vertical: "top" } });
    ws.getRow(row).height = height;
    row += 2;
  };
  prose("Description", project.description);
  prose("Notes du projet", text(project.notes, 30_000));

  ws.pageSetup.printArea = `A1:N${row}`;
  return ws;
}

// --- Classeur -----------------------------------------------------------------

export type ProjectExportData = {
  project: ProjectDto;
  risks: RiskDto[];
  meetings: MeetingDto[];
  ownerName: string;
  /** Notes riches des tâches (HTML), par id. */
  notes: Map<string, string>;
  /** Champs personnalisés renseignés, dans l'ordre de l'administration. */
  infos?: Array<{ label: string; value: string }>;
  now?: Date;
};

export async function buildProjectWorkbook(userId: string, projectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const project = await getProject(userId, projectId);
  const [risks, meetings, owner, notesByTask, fields] = await Promise.all([
    listRisks(userId, projectId),
    listMeetings(userId, projectId),
    prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true } }),
    prisma.task.findMany({ where: { projectId }, select: { id: true, notes: true } }),
    allCustomFields(),
  ]);
  return renderProjectWorkbook({
    project,
    risks,
    meetings,
    ownerName: owner?.name ?? "",
    notes: new Map(notesByTask.map((t) => [t.id, t.notes])),
    infos: customEntries(fields, project.customFields).map((e) => ({ label: e.label, value: e.value })),
  });
}

/** Rendu pur du classeur (sans accès base) : utilisé par la route et testable. */
export async function renderProjectWorkbook(data: ProjectExportData): Promise<{ buffer: Buffer; filename: string }> {
  const { project, risks, meetings, notes } = data;
  const now = data.now ?? new Date();
  const members = new Map(project.members.map((m) => [m.id, m]));
  const tasks = allTasks(project);
  const taskName = new Map(tasks.map(({ task }) => [task.id, task.name]));
  const today = now.toISOString().slice(0, 10);
  const stamp = now.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ");
  const memberName = (id: string | null) => (id ? (members.get(id)?.name ?? "") : "");

  // Références stables : T1… (ordre du plan), R1… / O1… (ordre du registre).
  const taskRef = new Map(tasks.map(({ task }, i) => [task.id, `T${i + 1}`]));
  const riskRef = new Map<string, string>();
  let r = 0;
  let o = 0;
  for (const k of risks) riskRef.set(k.id, k.kind === "RISK" ? `R${++r}` : `O${++o}`);
  const risksByTask = new Map<string, string[]>();
  for (const k of risks) for (const tid of k.taskIds) risksByTask.set(tid, [...(risksByTask.get(tid) ?? []), riskRef.get(k.id)!]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Second Brain";
  wb.lastModifiedBy = "Second Brain";
  wb.created = now;
  wb.modified = now;
  wb.title = project.name;
  wb.subject = "Export de projet";
  wb.description = `Export complet du projet « ${project.name} » (Second Brain).`;
  wb.calcProperties.fullCalcOnLoad = true;
  const ctx: Ctx = { wb, theme: makeTheme(project.color), project: project.name, stamp };

  const stageRows: Array<{ stage: string; activity: string; start: Date | null; due: Date | null; progress: number; total: number; done: number; description: string }> = [];
  for (const s of project.stages) {
    stageRows.push({ stage: s.name, activity: "", start: day(s.startDate), due: day(s.dueDate), progress: s.progress.percent / 100, total: s.progress.total, done: s.progress.done, description: s.description });
    for (const a of s.activities) stageRows.push({ stage: s.name, activity: a.name, start: null, due: null, progress: a.progress.percent / 100, total: a.progress.total, done: a.progress.done, description: a.description });
  }
  const datedCount = tasks.filter(({ task }) => task.startDate || task.dueDate).length;
  const nRisks = risks.filter((k) => k.kind === "RISK").length;

  // --- Synthèse (créée en premier : première feuille du classeur)
  summarySheet(ctx, {
    project,
    owner: data.ownerName,
    tasks,
    today,
    risks,
    meetings,
    infos: data.infos,
    contents: [
      { sheet: "Tâches", about: "Liste complète : statut, priorité, dates, personnes, prérequis, notes", count: plural(tasks.length, "tâche") },
      { sheet: "Planning", about: "Diagramme de Gantt des tâches datées", count: plural(datedCount, "tâche") },
      { sheet: "Étapes & activités", about: "Structure du projet et avancement par niveau", count: plural(stageRows.length, "ligne") },
      { sheet: "Livrables", about: "Livrables, échéances et documents associés", count: plural(project.deliverables.length, "livrable") },
      { sheet: "Risques & opportunités", about: "Registre : criticité, niveau, stratégie, plan de traitement", count: `${nf.format(nRisks)} R • ${nf.format(risks.length - nRisks)} O` },
      { sheet: "Matrices", about: "Matrices probabilité × gravité / bénéfice (éléments non clos)", count: "2 matrices" },
      { sheet: "Réunions", about: "Comptes-rendus, participants et validations", count: plural(meetings.length, "réunion") },
      { sheet: "Équipe", about: "Membres, rôles et charge de tâches", count: plural(project.members.length, "membre") },
      { sheet: "Documents", about: "Documents déposés et leur classement", count: plural(project.documents.length, "document") },
    ],
  });

  // --- Tâches
  dataSheet(
    ctx,
    "Tâches",
    { info: (n) => `${plural(n, "tâche")} dans l'ordre du plan` },
    [
      { header: "Réf.", key: "ref", width: 7, type: "ref" },
      { header: "Étape", key: "stage", width: 22, wrap: true },
      { header: "Activité", key: "activity", width: 22, wrap: true },
      { header: "Tâche", key: "name", width: 40, wrap: true },
      { header: "Statut", key: "status", width: 12, pill: byLabel(STATUS, STATUS_TONE) },
      { header: "Priorité", key: "priority", width: 11, pill: byLabel(PRIORITY, PRIORITY_TONE) },
      { header: "Complexité", key: "complexity", width: 11, pill: byLabel(COMPLEXITY, COMPLEXITY_TONE) },
      { header: "Avancement", key: "progress", width: 12, type: "pct" },
      { header: "Début", key: "start", width: 11.5, type: "date" },
      { header: "Échéance", key: "due", width: 11.5, type: "date" },
      { header: "Durée (j)", key: "duration", width: 9, type: "int" },
      { header: "Clôture", key: "closed", width: 11.5, type: "date" },
      { header: "En retard", key: "late", width: 9.5, type: "center" },
      { header: "Responsable", key: "assignee", width: 20 },
      { header: "Superviseur", key: "supervisor", width: 20 },
      { header: "Contributeurs", key: "contributors", width: 28, wrap: true },
      { header: "Prérequis", key: "prereq", width: 30, wrap: true },
      { header: "Risques liés", key: "risks", width: 13, type: "center" },
      { header: "Commentaires", key: "comments", width: 13, type: "int" },
      { header: "Description", key: "description", width: 40, wrap: true },
      { header: "Notes", key: "notes", width: 50, wrap: true },
      { header: "Dernière modification", key: "updated", width: 13, type: "date" },
    ],
    tasks,
    ({ task: t, stage, activity }) => {
      const s = day(t.startDate ?? t.dueDate);
      const e = day(t.dueDate ?? t.startDate);
      return {
        ref: taskRef.get(t.id),
        stage,
        activity,
        name: t.name,
        status: STATUS[t.status],
        priority: PRIORITY[t.priority],
        complexity: COMPLEXITY[t.complexity],
        progress: t.progress / 100,
        start: day(t.startDate),
        due: day(t.dueDate),
        duration: s && e ? Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1 : null,
        closed: day(t.closedAt),
        late: isLate(t, today) ? "Oui" : "Non",
        assignee: memberName(t.assigneeId),
        supervisor: memberName(t.supervisorId),
        contributors: t.contributorIds.map((id) => members.get(id)?.name).filter(Boolean).join(", "),
        prereq: (t.prerequisiteIds ?? []).map((id) => `${taskRef.get(id) ?? ""} ${taskName.get(id) ?? ""}`.trim()).join(", "),
        risks: (risksByTask.get(t.id) ?? []).join(", "),
        comments: t.commentCount,
        description: t.description,
        notes: text(notes.get(t.id)),
        updated: new Date(t.updatedAt),
      };
    },
    (cell, { task }) => {
      if (isLate(task, today)) {
        restyle(cell("due"), { font: font(10, RED, { bold: true }) });
        const l = cell("late");
        restyle(l, { font: font(10, TONES.red[1], { bold: true }), fill: solid(TONES.red[0]) });
      } else {
        restyle(cell("late"), { font: font(10, MUTED) });
      }
    },
  );

  // --- Planning
  planningSheet(ctx, tasks, taskRef, (t) => memberName(t.assigneeId), now);

  // --- Étapes & activités (hiérarchie : étapes en bandeau, activités en retrait)
  dataSheet(
    ctx,
    "Étapes & activités",
    { info: () => `${plural(project.stages.length, "étape")} • ${plural(stageRows.length - project.stages.length, "activité")}`, zebra: false },
    [
      { header: "Étape", key: "stage", width: 30, wrap: true },
      { header: "Activité", key: "activity", width: 30, wrap: true },
      { header: "Début", key: "start", width: 12, type: "date" },
      { header: "Échéance", key: "due", width: 12, type: "date" },
      { header: "Avancement", key: "progress", width: 14, type: "pct" },
      { header: "Tâches", key: "total", width: 9, type: "int" },
      { header: "Terminées", key: "done", width: 10, type: "int" },
      { header: "Description", key: "description", width: 60, wrap: true },
    ],
    stageRows,
    (x) => x,
    (cell, x) => {
      const keys = ["stage", "activity", "start", "due", "progress", "total", "done", "description"];
      if (!x.activity) {
        for (const k of keys) restyle(cell(k), { fill: solid(ctx.theme.tint), font: font(10, k === "description" ? TEXT : ctx.theme.ink, { bold: k !== "description" }) });
      } else {
        restyle(cell("stage"), { font: font(9, MUTED) });
        restyle(cell("activity"), { alignment: { ...cell("activity").alignment, indent: 1 } });
      }
    },
  );

  // --- Livrables
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));
  dataSheet(
    ctx,
    "Livrables",
    { info: (n) => plural(n, "livrable") },
    [
      { header: "Livrable", key: "name", width: 34, wrap: true },
      { header: "Étape", key: "stage", width: 22, wrap: true },
      { header: "Statut", key: "status", width: 12, pill: byLabel(DELIVERABLE_STATUS, DELIVERABLE_TONE) },
      { header: "Responsable", key: "assignee", width: 20 },
      { header: "Début prévu", key: "start", width: 12, type: "date" },
      { header: "Fin prévue", key: "end", width: 12, type: "date" },
      { header: "Livré le", key: "delivered", width: 12, type: "date" },
      { header: "Documents", key: "documents", width: 32, wrap: true },
      { header: "Description", key: "description", width: 44, wrap: true },
    ],
    project.deliverables,
    (d) => ({
      name: d.name,
      stage: d.stageId ? (stageName.get(d.stageId) ?? "") : "",
      status: DELIVERABLE_STATUS[d.status],
      assignee: memberName(d.assigneeId),
      start: day(d.expectedStart),
      end: day(d.expectedEnd),
      delivered: day(d.deliveredAt),
      documents: d.documents.map((doc) => doc.name).join(", "),
      description: d.description,
    }),
    (cell, d) => {
      // Fin prévue dépassée et pas encore livré : en rouge.
      if (d.expectedEnd && d.expectedEnd.slice(0, 10) < today && (d.status === "PLANNED" || d.status === "IN_PROGRESS")) restyle(cell("end"), { font: font(10, RED, { bold: true }) });
    },
  );

  // --- Risques & opportunités
  dataSheet(
    ctx,
    "Risques & opportunités",
    { info: () => `${plural(nRisks, "risque")} • ${plural(risks.length - nRisks, "opportunité")}`, xSplit: 0 },
    [
      { header: "Réf.", key: "ref", width: 7, type: "ref" },
      { header: "Nature", key: "kind", width: 13, type: "center" },
      { header: "Titre", key: "title", width: 36, wrap: true },
      { header: "Catégorie", key: "category", width: 16, wrap: true },
      { header: "Probabilité (1-5)", key: "p", width: 13, type: "int" },
      { header: "Gravité / bénéfice (1-5)", key: "i", width: 14, type: "int" },
      { header: "Criticité", key: "score", width: 10, type: "int" },
      { header: "Niveau", key: "level", width: 12, type: "center" },
      { header: "Statut", key: "status", width: 16, pill: byLabel(RISK_STATUS_LABEL, RISK_STATUS_TONE) },
      { header: "Responsable", key: "owner", width: 20 },
      { header: "Stratégie", key: "strategy", width: 22, wrap: true },
      { header: "Plan de traitement / d'exploitation", key: "response", width: 44, wrap: true },
      { header: "Tâches liées", key: "tasks", width: 34, wrap: true },
      { header: "Description", key: "description", width: 40, wrap: true },
    ],
    risks,
    (k) => ({
      ref: riskRef.get(k.id),
      kind: k.kind === "RISK" ? "Risque" : "Opportunité",
      title: k.title,
      category: k.category,
      p: k.probability,
      i: k.impact,
      score: k.score,
      level: k.levelLabel,
      status: RISK_STATUS_LABEL[k.status],
      owner: k.ownerName ?? "",
      strategy: strategyLabel(k.kind, k.strategy),
      response: k.response,
      tasks: k.tasks.map((t) => `${taskRef.get(t.id) ?? ""} ${t.name}`.trim()).join(", "),
      description: k.description,
    }),
    (cell, k) => {
      const [bg, fg] = (k.kind === "RISK" ? RISK_FILL : OPP_FILL)[k.level];
      restyle(cell("level"), { fill: solid(bg), font: font(10, fg, { bold: true }) });
      restyle(cell("score"), { font: font(11, fg === WHITE ? bg : fg, { bold: true }) });
      restyle(cell("kind"), { font: font(10, k.kind === "RISK" ? "B45309" : "0F766E", { bold: true }) });
    },
  );

  // --- Matrices (probabilité × gravité / bénéfice), éléments non clos
  const matrix = newSheet(ctx, "Matrices", { portrait: false, ySplit: 0 });
  matrix.pageSetup.fitToHeight = 1;
  matrix.columns = [{ width: 24 }, ...[1, 2, 3, 4, 5].map(() => ({ width: 19 }))];
  sheetTitle(ctx, matrix, "Matrices des risques et opportunités", 6, "éléments non clos • probabilité × gravité / bénéfice");
  const drawMatrix = (kind: "RISK" | "OPPORTUNITY", startRow: number) => {
    const fills = kind === "RISK" ? RISK_FILL : OPP_FILL;
    const items = risks.filter((k) => k.kind === kind && k.status !== "CLOSED");
    put(matrix, startRow, 1, 6, kind === "RISK" ? `Matrice des risques (non clos) — ${plural(items.length, "élément")}` : `Matrice des opportunités (non closes) — ${plural(items.length, "élément")}`, {
      font: font(13, ctx.theme.ink, { bold: true }),
      alignment: { vertical: "bottom" },
      border: { bottom: { style: "medium", color: argb(ctx.theme.brand) } },
    });
    matrix.getRow(startRow).height = 24;
    matrix.getRow(startRow + 1).height = 6;
    const axis = kind === "RISK" ? SEVERITY_LABELS : BENEFIT_LABELS;
    const labels = matrix.getRow(startRow + 2);
    labels.height = 30;
    const axisHead: Partial<ExcelJS.Style> = { font: font(10, ctx.theme.onBrand, { bold: true }), fill: solid(ctx.theme.brand), alignment: { horizontal: "center", vertical: "middle", wrapText: true }, border: { left: thin(WHITE), right: thin(WHITE), top: thin(WHITE), bottom: thin(WHITE) } };
    const corner = labels.getCell(1);
    corner.value = kind === "RISK" ? "Probabilité ↓ / Gravité →" : "Probabilité ↓ / Bénéfice →";
    corner.style = { ...axisHead, fill: solid(ctx.theme.ink), font: font(9, WHITE, { italic: true, bold: true }) };
    axis.forEach((l, j) => {
      const c = labels.getCell(j + 2);
      c.value = `${j + 1} · ${l}`;
      c.style = axisHead;
    });
    const tile = { style: "medium" as const, color: argb(WHITE) };
    for (let p = 5; p >= 1; p--) {
      const row = matrix.getRow(startRow + 3 + (5 - p));
      row.height = 46;
      const head = row.getCell(1);
      head.value = `${p} · ${PROBABILITY_LABELS[p - 1]}`;
      head.style = { font: font(10, ctx.theme.ink, { bold: true }), fill: solid(ctx.theme.tint), alignment: { horizontal: "left", vertical: "middle", indent: 1 }, border: { top: tile, bottom: tile, left: tile, right: tile } };
      for (let g = 1; g <= 5; g++) {
        const cell = row.getCell(g + 1);
        const inCell = items.filter((k) => k.probability === p && k.impact === g);
        const [bg, fg] = fills[riskLevel(p * g)];
        cell.value = inCell.length ? `${inCell.length} — ${inCell.map((k) => riskRef.get(k.id)).join(", ")}` : `(${p * g})`;
        cell.style = {
          alignment: { horizontal: "center", vertical: "middle", wrapText: true },
          fill: solid(bg),
          border: { top: tile, bottom: tile, left: tile, right: tile },
          font: inCell.length ? font(12, fg, { bold: true }) : font(9, fg === WHITE ? WHITE : mix(fg, bg, 0.45), { italic: true }),
        };
      }
    }
    const legend = matrix.getRow(startRow + 9);
    legend.height = 22;
    const lc = legend.getCell(1);
    lc.value = "Niveaux :";
    lc.style = { font: font(10, MUTED, { bold: true }), alignment: { horizontal: "right", vertical: "middle", indent: 1 } };
    (["low", "medium", "high", "critical"] as const).forEach((lv, j) => {
      const c = legend.getCell(j + 2);
      c.value = levelLabel(kind, lv);
      c.style = { fill: solid(fills[lv][0]), font: font(10, fills[lv][1], { bold: true }), alignment: { horizontal: "center", vertical: "middle" }, border: { left: tile, right: tile } };
    });
    return startRow + 11;
  };
  const next = drawMatrix("RISK", HEAD);
  drawMatrix("OPPORTUNITY", next + 1);

  // --- Réunions
  dataSheet(
    ctx,
    "Réunions",
    { info: (n) => plural(n, "réunion"), maxHeight: 300 },
    [
      { header: "Date", key: "date", width: 16, type: "datetime" },
      { header: "Titre", key: "title", width: 32, wrap: true },
      { header: "Lieu", key: "location", width: 18, wrap: true },
      { header: "Rédacteur", key: "author", width: 20 },
      { header: "Participants", key: "participants", width: 32, wrap: true },
      { header: "Validation", key: "status", width: 15, pill: byLabel(MEETING_STATUS, MEETING_TONE) },
      { header: "Validateurs et décisions", key: "approvers", width: 36, wrap: true },
      { header: "Compte-rendu", key: "minutes", width: 80, wrap: true },
    ],
    meetings,
    (m) => ({
      date: new Date(m.date),
      title: m.title,
      location: m.location,
      author: m.authorName,
      participants: m.participants.map((p) => p.name).join(", "),
      status: MEETING_STATUS[m.status],
      approvers: m.approvers.map((a) => `${a.name} : ${DECISION[a.decision]}${a.comment ? ` (« ${a.comment} »)` : ""}`).join("\n"),
      minutes: text(m.minutes),
    }),
  );

  // --- Équipe
  dataSheet(
    ctx,
    "Équipe",
    { info: (n) => plural(n, "membre") },
    [
      { header: "Nom", key: "name", width: 26 },
      { header: "E-mail", key: "email", width: 32 },
      { header: "Rôle", key: "role", width: 22, wrap: true },
      { header: "Compte", key: "account", width: 10, pill: { Oui: "green", Non: "grey" } },
      { header: "Responsable de (tâches)", key: "assigned", width: 14, type: "int" },
      { header: "Ouvertes", key: "open", width: 11, type: "int" },
    ],
    project.members,
    (m) => {
      const mine = tasks.filter(({ task }) => task.assigneeId === m.id);
      return {
        name: m.name,
        email: m.email ?? "",
        role: m.role ?? "",
        account: m.userId ? "Oui" : "Non",
        assigned: mine.length,
        open: mine.filter(({ task }) => task.status === "TODO" || task.status === "IN_PROGRESS").length,
      };
    },
    (cell, m) => {
      const c = parseHex(m.color);
      const name = cell("name");
      restyle(name, { font: font(10, TEXT, { bold: true }), ...(c ? { border: { ...GRID, left: { style: "thick", color: argb(c) } } } : {}) });
    },
  );

  // --- Documents
  const folders = new Map(project.folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    let cur = id ? folders.get(id) : undefined;
    let guard = 0;
    while (cur && guard++ < 50) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folders.get(cur.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  const deliverableName = new Map(project.deliverables.map((d) => [d.id, d.name]));
  dataSheet(
    ctx,
    "Documents",
    { info: (n) => plural(n, "document") },
    [
      { header: "Document", key: "name", width: 38, wrap: true },
      { header: "Dossier", key: "folder", width: 28, wrap: true },
      { header: "Type", key: "type", width: 24 },
      { header: "Taille (Ko)", key: "size", width: 11, type: "size" },
      { header: "Déposé par", key: "by", width: 20 },
      { header: "Date", key: "date", width: 12, type: "date" },
      { header: "Livrable", key: "deliverable", width: 28, wrap: true },
    ],
    project.documents,
    (d) => ({
      name: d.name,
      folder: pathOf(d.folderId),
      type: d.mimeType,
      size: Math.round(d.size / 1024),
      by: d.uploadedBy?.name ?? "",
      date: new Date(d.createdAt),
      deliverable: d.deliverableId ? (deliverableName.get(d.deliverableId) ?? "") : "",
    }),
  );

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "projet";
  return { buffer, filename: `${safe}-${today}.xlsx` };
}
