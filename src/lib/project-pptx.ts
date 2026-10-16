import "server-only";
import PptxGenJS from "pptxgenjs";
import { allCustomFields } from "@/lib/custom-fields";
import { customEntries } from "@/lib/shared/custom-fields";
import { getProject, type ProjectDto, type TaskDto } from "@/lib/projects";
import { listRisks, type RiskDto } from "@/lib/risks";
import { listMeetings, type MeetingDto } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { STRATEGY_LABEL, RISK_STATUS_LABEL, riskLevel, type RiskLevel } from "@/lib/shared/risks";

/**
 * Export PowerPoint « état des lieux » d'un projet (bouton « Export
 * PowerPoint » de la fiche projet) : présentation 16:9 aux couleurs du projet,
 * prête à être commentée en comité. Chaque diapositive de contenu porte un
 * encadré « Commentaire du chef de projet » (note jaune à bordure pointillée)
 * à compléter dans PowerPoint.
 *
 * Diapositives : Titre, Synthèse (indicateurs + graphique natif), Avancement
 * par étape, Planning des étapes, Points d'attention, Risques et opportunités
 * (registre + matrice 5×5), Livrables, Réunions et décisions, Équipe,
 * Prochaines étapes (30 jours). Les tableaux longs sont paginés (lignes
 * plafonnées par diapositive, nombre de pages borné) ; uniquement des
 * agrégats : quelques dizaines de millisecondes pour 4 000 tâches.
 *
 * Mêmes droits que la lecture du projet (`getProject` : 404 sans accès) ;
 * projets types exclus (404, y compris pour un administrateur).
 */

// --- Libellés -----------------------------------------------------------------

const STATUS: Record<string, string> = { TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CLOSED: "Clôturée" };
const PROJECT_STATUS: Record<string, string> = { ACTIVE: "Actif", ON_HOLD: "En pause", DONE: "Terminé", ARCHIVED: "Archivé" };
const DELIVERABLE_STATUS: Record<string, string> = { PLANNED: "Prévu", IN_PROGRESS: "En cours", DELIVERED: "Livré", VALIDATED: "Validé" };
const MEETING_STATUS: Record<string, string> = { draft: "Brouillon", no_review: "Sans validation", pending: "En validation", approved: "Validé", rejected: "Refusé" };

// --- Couleurs (hex sans #) ----------------------------------------------------

const DEFAULT_BRAND = "4F5FF0";
const TEXT = "1F2937";
const MUTED = "6B7280";
const FAINT = "9CA3AF";
const LINE = "E3E6EC";
const SURFACE = "F7F8FA";
const WHITE = "FFFFFF";
const RED = "DC2626";
const GREEN = "059669";
const AMBER = "D97706";
const FONT = "Calibri";
/** Note « commentaire du chef de projet ». */
const NOTE_FILL = "FFF8DB";
const NOTE_LINE = "D4A72C";
const NOTE_INK = "7A5600";

type Tone = [fill: string, text: string];
const TONE: Record<string, Tone> = {
  grey: ["EEF0F3", "4B5563"],
  blue: ["DBEAFE", "1E40AF"],
  green: ["D1FAE5", "065F46"],
  violet: ["EDE9FE", "5B21B6"],
  red: ["FEE2E2", "991B1B"],
  orange: ["FFEDD5", "9A3412"],
  amber: ["FEF3C7", "92400E"],
  teal: ["CCFBF1", "115E59"],
};
const STATUS_COLOR: Record<string, string> = { TODO: "9CA3AF", IN_PROGRESS: "3B82F6", DONE: "10B981", CLOSED: "8B5CF6" };
const DELIVERABLE_TONE: Record<string, string> = { PLANNED: "grey", IN_PROGRESS: "blue", DELIVERED: "teal", VALIDATED: "green" };
const MEETING_TONE: Record<string, string> = { draft: "grey", no_review: "grey", pending: "amber", approved: "green", rejected: "red" };
const RISK_STATUS_TONE: Record<string, string> = { OPEN: "orange", MONITORING: "amber", TREATED: "blue", CLOSED: "grey" };
const RISK_FILL: Record<RiskLevel, Tone> = { low: ["C6EFCE", "14532D"], medium: ["FFEB9C", "713F12"], high: ["F8CBAD", "7C2D12"], critical: ["FF7C80", "7F1D1D"] };
const OPP_FILL: Record<RiskLevel, Tone> = { low: ["DDF2F0", "134E4A"], medium: ["A8DDD5", "134E4A"], high: ["5FBFB0", "FFFFFF"], critical: ["2A9D8F", "FFFFFF"] };

function parseHex(c: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
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

type Theme = { brand: string; ink: string; tint: string; soft: string; deep: string; onBrand: string; onBrandSub: string };
function makeTheme(color: string | null): Theme {
  const brand = parseHex(color) ?? DEFAULT_BRAND;
  const light = luminance(brand) > 0.45;
  return {
    brand,
    ink: mix(brand, "111827", light ? 0.7 : 0.35),
    deep: mix(brand, "0B1020", 0.45),
    tint: mix(brand, WHITE, 0.92),
    soft: mix(brand, WHITE, 0.6),
    onBrand: light ? "111827" : WHITE,
    onBrandSub: light ? "374151" : mix(brand, WHITE, 0.75),
  };
}

// --- Utilitaires --------------------------------------------------------------

const DAY_MS = 86_400_000;
const nf = new Intl.NumberFormat("fr-FR");
/** Supprime les caractères de contrôle (XML invalide) et tronque. */
function clean(s: string | null | undefined, max = 120): string {
  // eslint-disable-next-line no-control-regex
  const v = (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
}
const dayKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const dayNum = (key: string) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
function fmtDay(iso: string | null | undefined): string {
  const k = dayKey(iso);
  if (!k) return "—";
  const [y, m, d] = k.split("-");
  return `${d}/${m}/${y}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n > 1 ? many : one}`;
const isClosed = (t: TaskDto) => t.status === "DONE" || t.status === "CLOSED";

type TaskRef = { task: TaskDto; stage: string };
function allTasks(p: ProjectDto): TaskRef[] {
  const out: TaskRef[] = [];
  for (const s of p.stages) {
    for (const a of s.activities) for (const t of a.tasks) out.push({ task: t, stage: s.name });
    for (const t of s.tasks) out.push({ task: t, stage: s.name });
  }
  for (const t of p.tasks) out.push({ task: t, stage: "" });
  return out;
}

/** Pagine `rows` (au plus `per` lignes par page, pages équilibrées, `maxPages` au plus) ; `rest` = lignes non affichées. */
function chunk<T>(rows: T[], max: number, maxPages: number): { pages: T[][]; rest: number } {
  const n = Math.min(maxPages, Math.ceil(rows.length / max));
  const per = n > 0 ? Math.ceil(Math.min(rows.length, max * n) / n) : max;
  const pages: T[][] = [];
  for (let i = 0; i < rows.length && pages.length < maxPages; i += per) pages.push(rows.slice(i, i + per));
  const shown = pages.reduce((n, p) => n + p.length, 0);
  return { pages: pages.length ? pages : [[]], rest: rows.length - shown };
}

// --- Mise en page -------------------------------------------------------------

/** Diapositive 16:9 « large » : 13,333 × 7,5 pouces. */
const W = 13.333;
const MX = 0.5;
const CW = W - 2 * MX;
const TOP = 1.3;
const BOTTOM = 6.85;

/** `bottom` : bas du contenu de la diapositive courante (l'encadré à commenter occupe le reste). */
type Ctx = { pptx: PptxGenJS; theme: Theme; project: string; stamp: string; bottom: number };

function defineMasters(ctx: Ctx) {
  const { pptx, theme } = ctx;
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: WHITE },
    margin: [0.3, 0.3, 0.3, 0.3],
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.09, fill: { color: theme.brand }, line: { type: "none" } } },
      { rect: { x: MX, y: 1.02, w: 0.7, h: 0.05, fill: { color: theme.brand }, line: { type: "none" } } },
      { line: { x: MX, y: 7.02, w: CW, h: 0, line: { color: LINE, width: 0.75 } } },
      { text: { text: clean(ctx.project, 80), options: { x: MX, y: 7.06, w: 6, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, bold: true, margin: 0, valign: "middle" } } },
      { text: { text: `État des lieux · export du ${ctx.stamp}`, options: { x: 4.17, y: 7.06, w: 5, h: 0.3, fontFace: FONT, fontSize: 9, color: FAINT, align: "center", margin: 0, valign: "middle" } } },
    ],
    slideNumber: { x: W - MX - 0.6, y: 7.06, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: theme.ink, bold: true, align: "right", margin: 0, valign: "middle" },
  });
}

function contentSlide(ctx: Ctx, title: string, subtitle?: string): PptxGenJS.Slide {
  const slide = ctx.pptx.addSlide({ masterName: "CONTENT" });
  ctx.bottom = TOP;
  slide.addText(title, { x: MX, y: 0.3, w: CW, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: ctx.theme.ink, margin: 0, valign: "bottom" });
  if (subtitle) slide.addText(subtitle, { x: MX + 0.85, y: 0.92, w: CW - 0.85, h: 0.26, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0, valign: "middle" });
  return slide;
}

/** Encadré à compléter par le chef de projet : note jaune, bordure pointillée. */
function commentBox(slide: PptxGenJS.Slide, box: { x: number; y: number; w: number; h: number }, prompt: string, title = "Commentaire du chef de projet") {
  slide.addText(
    [
      { text: `💬  ${title}`, options: { bold: true, fontSize: 12, color: NOTE_INK, breakLine: true } },
      { text: `Cliquez pour commenter : ${prompt}`, options: { italic: true, fontSize: 11, color: "8A6D1F" } },
    ],
    {
      ...box,
      shape: "roundRect" as PptxGenJS.ShapeType,
      rectRadius: 0.08,
      fill: { color: NOTE_FILL },
      line: { color: NOTE_LINE, width: 1.25, dashType: "dash" },
      fontFace: FONT,
      valign: "top",
      margin: [8, 10, 8, 10],
      paraSpaceAfter: 4,
    },
  );
}

/** Encadré à commenter pleine largeur sous le contenu (au moins `minH` pouces). */
function flexComment(ctx: Ctx, slide: PptxGenJS.Slide, prompt: string, title?: string, minH = 1.25) {
  const y = Math.min(BOTTOM - minH, ctx.bottom + 0.3);
  commentBox(slide, { x: MX, y, w: CW, h: BOTTOM - y }, prompt, title);
}
const reach = (ctx: Ctx, y: number) => {
  ctx.bottom = Math.max(ctx.bottom, y);
};

function emptyState(ctx: Ctx, slide: PptxGenJS.Slide, box: { x: number; y: number; w: number; h: number }, message: string) {
  reach(ctx, box.y + box.h);
  slide.addText(message, {
    ...box,
    shape: "roundRect" as PptxGenJS.ShapeType,
    rectRadius: 0.08,
    fill: { color: SURFACE },
    line: { color: LINE, width: 0.75 },
    fontFace: FONT,
    fontSize: 14,
    italic: true,
    color: MUTED,
    align: "center",
    valign: "middle",
  });
}

/** Carte indicateur : grand chiffre + libellé + précision. */
function kpiCard(ctx: Ctx, slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, value: string, label: string, hint: string, accent?: string) {
  slide.addShape("roundRect" as PptxGenJS.ShapeType, { x, y, w, h, rectRadius: 0.08, fill: { color: WHITE }, line: { color: LINE, width: 0.75 } });
  slide.addShape("rect" as PptxGenJS.ShapeType, { x: x + 0.12, y: y + 0.16, w: 0.05, h: h - 0.32, fill: { color: accent ?? ctx.theme.brand }, line: { type: "none" } });
  slide.addText(value, { x: x + 0.25, y: y + 0.08, w: w - 0.3, h: h * 0.48, fontFace: FONT, fontSize: 26, bold: true, color: accent ?? ctx.theme.ink, margin: 0, valign: "bottom" });
  slide.addText(
    [
      { text: label, options: { bold: true, fontSize: 11, color: TEXT, breakLine: true } },
      { text: hint, options: { fontSize: 9, color: MUTED } },
    ],
    { x: x + 0.25, y: y + h * 0.56, w: w - 0.3, h: h * 0.4, fontFace: FONT, margin: 0, valign: "top" },
  );
}

/** Liste « libellé / valeur » séparée par des filets (carte de titre, fiche projet). */
function infoRows(slide: PptxGenJS.Slide, box: { x: number; y: number; w: number; h: number }, rows: Array<[string, string]>, labelW: number, maxRowH = 0.46) {
  const rowH = Math.min(maxRowH, box.h / Math.max(1, rows.length));
  rows.forEach(([k, v], i) => {
    const y = box.y + i * rowH;
    slide.addText(k, { x: box.x, y, w: labelW, h: rowH, fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0, valign: "middle" });
    slide.addText(v || "—", { x: box.x + labelW, y, w: box.w - labelW, h: rowH, fontFace: FONT, fontSize: 11.5, bold: true, color: TEXT, margin: 0, valign: "middle", fit: "shrink" });
    if (i < rows.length - 1) slide.addShape("line" as PptxGenJS.ShapeType, { x: box.x, y: y + rowH, w: box.w, h: 0, line: { color: LINE, width: 0.5 } });
  });
  return rowH * rows.length;
}

/** Corps d'une diapositive sans données : message sobre + grand encadré à commenter. */
function emptyBody(ctx: Ctx, slide: PptxGenJS.Slide, message: string, prompt: string, title?: string) {
  emptyState(ctx, slide, { x: MX, y: TOP, w: CW, h: 1.1 }, message);
  commentBox(slide, { x: MX, y: TOP + 1.35, w: CW, h: BOTTOM - TOP - 1.35 }, prompt, title);
}

type Col = { label: string; w: number; align?: "left" | "center" | "right" };
type Cell = string | { text: string; tone?: string; color?: string; bold?: boolean; fill?: string };

/** Tableau mis en forme : en-tête à la couleur du projet, lignes alternées, pastilles. */
function table(ctx: Ctx, slide: PptxGenJS.Slide, x: number, y: number, cols: Col[], rows: Cell[][], rowH = 0.34) {
  const head: PptxGenJS.TableRow = cols.map((c) => ({
    text: c.label,
    options: { bold: true, color: ctx.theme.onBrand, fill: { color: ctx.theme.brand }, align: c.align ?? "left", fontSize: 10.5 },
  }));
  const body: PptxGenJS.TableRow[] = rows.map((r, i) =>
    r.map((cell, j) => {
      const c = typeof cell === "string" ? { text: cell } : cell;
      const tone = c.tone ? TONE[c.tone] : null;
      return {
        text: c.text,
        options: {
          align: cols[j].align ?? "left",
          color: tone ? tone[1] : (c.color ?? TEXT),
          bold: c.bold ?? !!tone,
          fill: { color: c.fill ?? (tone ? tone[0] : i % 2 ? ctx.theme.tint : WHITE) },
          fontSize: 10.5,
        },
      };
    }),
  );
  slide.addTable([head, ...body], {
    x,
    y,
    colW: cols.map((c) => c.w),
    rowH,
    fontFace: FONT,
    valign: "middle",
    margin: [2, 6, 2, 6],
    border: { type: "solid", pt: 0.5, color: LINE },
    autoPage: false,
  });
  reach(ctx, y + rowH * (rows.length + 1));
}

function moreNote(ctx: Ctx, slide: PptxGenJS.Slide, x: number, w: number, rest: number, what: string, whats?: string) {
  if (rest <= 0) return;
  const y = ctx.bottom + 0.04;
  reach(ctx, y + 0.25);
  slide.addText(`+ ${plural(rest, what, whats)} — détail complet dans l'export Excel`, {
    x, y, w, h: 0.25, fontFace: FONT, fontSize: 9, italic: true, color: MUTED, margin: 0,
  });
}

/** Pas de graduation « rond » (1, 2, 5 × 10ⁿ) au moins égal à `raw`. */
function niceStep(raw: number): number {
  const r = Math.max(1, raw);
  const p = 10 ** Math.floor(Math.log10(r));
  return ([1, 2, 5, 10].find((m) => m * p >= r) ?? 10) * p;
}

const pageTitle = (title: string, i: number, n: number) => (n > 1 ? `${title} (${i + 1}/${n})` : title);

// --- Données ------------------------------------------------------------------

export type ProjectDeckData = {
  project: ProjectDto;
  risks: RiskDto[];
  meetings: MeetingDto[];
  ownerName: string;
  /** Champs personnalisés renseignés (libellé, valeur affichée). */
  infos: { label: string; value: string }[];
  now?: Date;
};

export async function buildProjectDeck(userId: string, projectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const project = await getProject(userId, projectId);
  // Un projet type (ouvrable par un administrateur) n'a pas d'état des lieux.
  if (project.isTemplate) throw notFound("Projet");
  const [risks, meetings, owner, fields] = await Promise.all([
    listRisks(userId, projectId),
    listMeetings(userId, projectId),
    prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true } }),
    allCustomFields(),
  ]);
  return renderProjectDeck({
    project,
    risks,
    meetings,
    ownerName: owner?.name ?? "",
    infos: customEntries(fields, project.customFields).map((e) => ({ label: e.label, value: e.value })),
  });
}

/** Rendu pur de la présentation (sans accès base). */
export async function renderProjectDeck(data: ProjectDeckData): Promise<{ buffer: Buffer; filename: string }> {
  const { project, risks, meetings } = data;
  const now = data.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const todayN = dayNum(today);
  const stamp = now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  const theme = makeTheme(project.color);
  const members = new Map(project.members.map((m) => [m.id, m]));
  const memberName = (id: string | null) => (id ? (members.get(id)?.name ?? "") : "");
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));

  // Agrégats (une passe sur les tâches).
  const tasks = allTasks(project);
  const closedIds = new Set<string>();
  const byStatus: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
  for (const { task } of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    if (isClosed(task)) closedIds.add(task.id);
  }
  const lateDays = (t: TaskDto) => (t.dueDate && !isClosed(t) ? todayN - dayNum(t.dueDate.slice(0, 10)) : 0);
  const late = tasks.filter(({ task }) => lateDays(task) > 0).sort((a, b) => lateDays(b.task) - lateDays(a.task));
  const lateByStage = new Map<string, number>();
  for (const { task } of late) if (task.stageId) lateByStage.set(task.stageId, (lateByStage.get(task.stageId) ?? 0) + 1);
  const critical = tasks.filter(({ task }) => !isClosed(task) && task.priority === "CRITICAL");
  const blocked = tasks.filter(({ task }) => !isClosed(task) && task.prerequisiteIds.some((id) => !closedIds.has(id)));
  const done = byStatus.DONE + byStatus.CLOSED;
  const deliverables = project.deliverables;
  const delivered = deliverables.filter((d) => d.status === "DELIVERED" || d.status === "VALIDATED").length;
  const deliverableLate = (d: (typeof deliverables)[number]) => d.status !== "DELIVERED" && d.status !== "VALIDATED" && !!d.expectedEnd && d.expectedEnd.slice(0, 10) < today;
  const openRisks = risks.filter((r) => r.kind === "RISK" && r.status !== "CLOSED");
  const openOpps = risks.filter((r) => r.kind === "OPPORTUNITY" && r.status !== "CLOSED");
  const hotRisks = openRisks.filter((r) => r.level === "high" || r.level === "critical").length;
  const unassignedOpen = tasks.filter(({ task }) => !isClosed(task) && !task.assigneeId).length;
  const pastMeetings = meetings.filter((m) => m.date.slice(0, 10) <= today).length;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Second Brain";
  pptx.company = "Second Brain";
  pptx.title = `${project.name} — état des lieux`;
  pptx.subject = "État des lieux du projet";
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const ctx: Ctx = { pptx, theme, project: project.name, stamp, bottom: TOP };
  defineMasters(ctx);

  // --- 1. Titre
  {
    const s = pptx.addSlide();
    s.background = { color: theme.brand };
    s.addShape("rect" as PptxGenJS.ShapeType, { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: theme.deep }, line: { type: "none" } });
    s.addShape("ellipse" as PptxGenJS.ShapeType, { x: 5.6, y: 4.4, w: 5.2, h: 5.2, fill: { color: WHITE, transparency: 92 }, line: { type: "none" } });
    s.addText("ÉTAT DES LIEUX DU PROJET", { x: 0.9, y: 1.25, w: 7, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: theme.onBrandSub, charSpacing: 3, margin: 0 });
    const name = clean(project.name, 90);
    // ~26 caractères par ligne en corps 40 sur 7,2 pouces : hauteur du titre ajustée.
    const titleH = Math.min(3, Math.ceil(name.length / 26)) * 0.66;
    s.addText(name, { x: 0.9, y: 1.7, w: 7.2, h: titleH, fontFace: FONT, fontSize: 40, bold: true, color: theme.onBrand, margin: 0, valign: "top", fit: "shrink" });
    const ruleY = 1.7 + titleH + 0.25;
    s.addShape("rect" as PptxGenJS.ShapeType, { x: 0.9, y: ruleY, w: 0.9, h: 0.06, fill: { color: theme.onBrand }, line: { type: "none" } });
    const desc = clean(project.description, 260);
    if (desc) s.addText(desc, { x: 0.9, y: ruleY + 0.3, w: 7, h: 1.5, fontFace: FONT, fontSize: 15, color: theme.onBrandSub, margin: 0, valign: "top" });
    s.addText(`Export du ${stamp}`, { x: 0.9, y: 6.55, w: 6, h: 0.35, fontFace: FONT, fontSize: 12, color: theme.onBrandSub, margin: 0 });

    const items: Array<[string, string]> = [
      ["Statut", PROJECT_STATUS[project.status] ?? project.status],
      ["Chef de projet", data.ownerName || "—"],
      ["Début", fmtDay(project.startDate)],
      ["Échéance", fmtDay(project.dueDate)],
      ["Avancement", `${project.progress.percent} %`],
      ["Équipe", plural(project.members.length, "membre")],
      ...data.infos.slice(0, 6).map((i): [string, string] => [clean(i.label, 40), clean(i.value, 60)]),
    ];
    const rows = items.slice(0, 12);
    const rowH = 0.46;
    const card = { x: 8.45, w: 4.3, h: Math.min(6.2, rows.length * rowH + 0.5), y: 0 };
    card.y = Math.max(0.6, (7.5 - card.h) / 2);
    s.addShape("roundRect" as PptxGenJS.ShapeType, { ...card, rectRadius: 0.12, fill: { color: WHITE }, line: { type: "none" }, shadow: { type: "outer", blur: 8, offset: 3, angle: 90, color: "000000", opacity: 0.18 } });
    infoRows(s, { x: card.x + 0.3, y: card.y + 0.25, w: card.w - 0.6, h: card.h - 0.5 }, rows, 1.65, rowH);
  }

  // --- 2. Synthèse
  {
    const s = contentSlide(ctx, "Synthèse", `Situation au ${stamp}`);
    const cards: Array<[string, string, string, string?]> = [
      [`${project.progress.percent} %`, "Avancement", "moyenne des tâches"],
      [nf.format(tasks.length), "Tâches", `${nf.format(byStatus.IN_PROGRESS)} en cours`],
      [nf.format(done), "Terminées", tasks.length ? `${Math.round((done / tasks.length) * 100)} % des tâches` : "aucune tâche", GREEN],
      [nf.format(late.length), "En retard", "échéance dépassée", late.length ? RED : GREEN],
      [`${delivered}/${deliverables.length}`, "Livrables", "livrés ou validés"],
      [nf.format(openRisks.length), "Risques ouverts", `${hotRisks} élevé${hotRisks > 1 ? "s" : ""} ou critique${hotRisks > 1 ? "s" : ""}`, hotRisks ? AMBER : undefined],
      [nf.format(meetings.length), "Réunions", `${pastMeetings} tenue${pastMeetings > 1 ? "s" : ""}`],
    ];
    const gap = 0.14;
    const cw = (CW - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([v, l, h, a], i) => kpiCard(ctx, s, MX + i * (cw + gap), TOP, cw, 1.2, v, l, h, a));

    const y = TOP + 1.45;
    const h = BOTTOM - y;
    s.addText("Tâches par statut", { x: MX, y, w: 4.4, h: 0.3, fontFace: FONT, fontSize: 13, bold: true, color: TEXT, margin: 0 });
    if (tasks.length) {
      const keys = ["TODO", "IN_PROGRESS", "DONE", "CLOSED"].filter((k) => byStatus[k] > 0);
      s.addChart(pptx.ChartType.doughnut, [{ name: "Tâches", labels: keys.map((k) => STATUS[k]), values: keys.map((k) => byStatus[k]) }], {
        x: MX, y: y + 0.3, w: 4.4, h: h - 0.3,
        holeSize: 58,
        chartColors: keys.map((k) => STATUS_COLOR[k]),
        showLegend: true, legendPos: "r", legendFontFace: FONT, legendFontSize: 11, legendColor: TEXT,
        showPercent: true, showValue: false, dataLabelColor: WHITE, dataLabelFontSize: 10, dataLabelFontBold: true,
        dataBorder: { pt: 1.5, color: WHITE },
      });
    } else emptyState(ctx, s, { x: MX, y: y + 0.4, w: 4.4, h: h - 0.5 }, "Aucune tâche.");

    // Fiche projet : dates + champs personnalisés.
    const ix = MX + 4.65;
    const iw = 3.6;
    s.addText("Fiche projet", { x: ix, y, w: iw, h: 0.3, fontFace: FONT, fontSize: 13, bold: true, color: TEXT, margin: 0 });
    const current = project.stages.find((st) => st.progress.percent < 100);
    const milestone = project.stages
      .filter((st) => st.dueDate && st.dueDate.slice(0, 10) >= today && st.progress.percent < 100)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
    const info: Array<[string, string]> = [
      ["Statut", PROJECT_STATUS[project.status] ?? project.status],
      ["Chef de projet", data.ownerName || "—"],
      ["Période", `${fmtDay(project.startDate)} → ${fmtDay(project.dueDate)}`],
      ["Étapes", `${nf.format(project.stages.length)}${current ? ` · en cours : ${clean(current.name, 30)}` : ""}`],
      ["Prochain jalon", milestone ? `${clean(milestone.name, 30)} (${fmtDay(milestone.dueDate)})` : "—"],
      ["Non affectées", plural(unassignedOpen, "tâche ouverte", "tâches ouvertes")],
      ...data.infos.map((i): [string, string] => [clean(i.label, 40), clean(i.value, 80)]),
    ].slice(0, 10) as Array<[string, string]>;
    const ficheH = Math.min(h - 0.35, info.length * 0.44 + 0.2);
    s.addShape("roundRect" as PptxGenJS.ShapeType, { x: ix, y: y + 0.35, w: iw, h: ficheH, rectRadius: 0.08, fill: { color: theme.tint }, line: { type: "none" } });
    infoRows(s, { x: ix + 0.2, y: y + 0.45, w: iw - 0.4, h: ficheH - 0.2 }, info, 1.25, 0.44);

    const cx = ix + iw + 0.25;
    commentBox(s, { x: cx, y, w: MX + CW - cx, h }, "message clé, tendance depuis le dernier point, faits marquants, météo du projet…", "Message du chef de projet");
  }

  // --- 3. Avancement par étape
  {
    const stages = project.stages;
    const { pages, rest } = chunk(stages, 12, 4);
    pages.forEach((page, pi) => {
      const s = contentSlide(ctx, pageTitle("Avancement par étape", pi, pages.length), stages.length ? `${plural(stages.length, "étape")} · avancement moyen ${project.progress.percent} %` : undefined);
      const tableBottom = BOTTOM - 1.45;
      if (!page.length) {
        return emptyBody(ctx, s, "Aucune étape définie : le projet n'est pas encore structuré en étapes.", "structuration du projet, étapes prévues, calendrier envisagé…");
      } else {
        const chartW = 5.1;
        const chartH = Math.min(tableBottom - TOP + 0.05, 0.42 * page.length + 0.5);
        reach(ctx, TOP - 0.05 + chartH);
        s.addChart(pptx.ChartType.bar, [{ name: "Avancement", labels: [...page].reverse().map((st) => clean(st.name, 28)), values: [...page].reverse().map((st) => st.progress.percent) }], {
          x: MX - 0.1, y: TOP - 0.05, w: chartW, h: chartH,
          barDir: "bar", barGapWidthPct: 45,
          chartColors: [theme.brand],
          catAxisLabelFontSize: 10, catAxisLabelColor: TEXT, catAxisLabelFontFace: FONT, catAxisLineShow: false,
          valAxisMinVal: 0, valAxisMaxVal: 118, valAxisHidden: true,
          valGridLine: { style: "none" },
          showValue: true, dataLabelFormatCode: "0\"%\"", dataLabelFontSize: 9, dataLabelColor: TEXT, dataLabelPosition: "outEnd",
        });
        const tx = MX + chartW + 0.1;
        const tw = MX + CW - tx;
        const cols: Col[] = [
          { label: "Étape", w: tw - 4.35 },
          { label: "Tâches faites", w: 1.1, align: "center" },
          { label: "Début", w: 1.05, align: "center" },
          { label: "Échéance", w: 1.05, align: "center" },
          { label: "Retards", w: 1.15, align: "center" },
        ];
        const rows: Cell[][] = page.map((st) => {
          const lateN = lateByStage.get(st.id) ?? 0;
          const overdue = !!st.dueDate && st.dueDate.slice(0, 10) < today && st.progress.percent < 100;
          return [
            clean(st.name, 50),
            `${nf.format(st.progress.done)}/${nf.format(st.progress.total)}`,
            fmtDay(st.startDate),
            overdue ? { text: fmtDay(st.dueDate), color: RED, bold: true } : fmtDay(st.dueDate),
            lateN ? { text: nf.format(lateN), tone: "red" } : { text: "0", color: FAINT },
          ];
        });
        table(ctx, s, tx, TOP, cols, rows, Math.min(0.42, (tableBottom - TOP) / (rows.length + 1)));
        if (pi === pages.length - 1) moreNote(ctx, s, tx, tw, rest, "étape");
      }
      flexComment(ctx, s, "étapes en avance ou en retard, causes des écarts, arbitrages proposés…");
    });
  }

  // --- 4. Planning (Gantt des étapes)
  {
    type Bar = { name: string; start: number; end: number; percent: number; milestone: boolean; overdue: boolean };
    const bars: Bar[] = [];
    for (const st of project.stages) {
      const a = dayKey(st.startDate);
      const b = dayKey(st.dueDate);
      if (!a && !b) continue;
      const start = dayNum((a ?? b)!);
      const end = Math.max(start, dayNum((b ?? a)!));
      bars.push({ name: st.name, start, end, percent: st.progress.percent, milestone: !a || !b, overdue: !!b && b < today && st.progress.percent < 100 });
    }
    const undated = project.stages.length - bars.length;
    const { pages } = chunk(bars, 12, 4);
    pages.forEach((page, pi) => {
      const s = contentSlide(ctx, pageTitle("Planning des étapes", pi, pages.length), bars.length ? `${plural(bars.length, "étape datée", "étapes datées")}${undated ? ` · ${plural(undated, "étape")} sans dates` : ""}` : undefined);
      const areaBottom = BOTTOM - 1.25;
      if (!bars.length) {
        return emptyBody(ctx, s, project.stages.length ? "Aucune étape datée : renseignez les dates de début et d'échéance des étapes pour afficher le planning." : "Aucune étape définie : pas de planning à afficher.", "calendrier prévisionnel, jalons clés, dates à confirmer…");
      } else {
        let min = Math.min(...bars.map((b) => b.start));
        let max = Math.max(...bars.map((b) => b.end));
        if (min <= todayN && todayN <= max + 30) max = Math.max(max, todayN);
        if (max - min < 28) {
          min -= 7;
          max += 7;
        }
        // Marge à droite : le pourcentage de la dernière barre reste lisible.
        max += Math.ceil((max - min) * 0.07);
        // Graduation : premier jour de chaque mois (ou trimestre si > 18 mois).
        const d0 = new Date(min * DAY_MS);
        const ticks: Array<{ n: number; label: string }> = [];
        const step = max - min > 540 ? 3 : 1;
        let m = new Date(Date.UTC(d0.getUTCFullYear(), Math.floor(d0.getUTCMonth() / step) * step, 1));
        while (m.getTime() / DAY_MS <= max) {
          const n = Math.floor(m.getTime() / DAY_MS);
          const label = step === 3 ? `T${Math.floor(m.getUTCMonth() / 3) + 1} ${m.getUTCFullYear()}` : m.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
          ticks.push({ n, label });
          m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + step, 1));
        }
        min = Math.min(min, ticks[0]?.n ?? min);
        const labelW = 3.1;
        const gx = MX + labelW + 0.1;
        const gw = MX + CW - gx;
        const span = Math.max(1, max - min + 1);
        const X = (n: number) => gx + ((n - min) / span) * gw;
        const headY = TOP;
        const rowsY = headY + 0.4;
        const rowH = Math.min(0.42, (areaBottom - rowsY) / page.length);
        const gridBottom = rowsY + rowH * page.length;
        s.addShape("rect" as PptxGenJS.ShapeType, { x: gx, y: headY, w: gw, h: 0.32, fill: { color: theme.tint }, line: { type: "none" } });
        const maxLabels = 18;
        const every = Math.max(1, Math.ceil(ticks.length / maxLabels));
        ticks.forEach((t, i) => {
          const x = X(t.n);
          if (x < gx - 0.001 || x > gx + gw) return;
          s.addShape("line" as PptxGenJS.ShapeType, { x, y: headY, w: 0, h: gridBottom - headY, line: { color: LINE, width: 0.5 } });
          const room = X(Math.min(ticks[i + every]?.n ?? max + 1, max + 1)) - x - 0.03;
          if (i % every === 0 && room >= 0.5) {
            s.addText(t.label, { x: x + 0.03, y: headY, w: room, h: 0.32, fontFace: FONT, fontSize: 9, color: theme.ink, bold: true, margin: 0, valign: "middle" });
          }
        });
        page.forEach((b, i) => {
          const y = rowsY + i * rowH;
          if (i % 2 === 1) s.addShape("rect" as PptxGenJS.ShapeType, { x: MX, y, w: CW, h: rowH, fill: { color: SURFACE }, line: { type: "none" } });
          s.addText(clean(b.name, 45), { x: MX, y, w: labelW, h: rowH, fontFace: FONT, fontSize: 10.5, color: b.overdue ? RED : TEXT, bold: b.overdue, margin: [0, 4, 0, 0], valign: "middle" });
          const bh = rowH * 0.56;
          const by = y + (rowH - bh) / 2;
          if (b.milestone) {
            const x = X(b.end + 0.5);
            s.addShape("diamond" as PptxGenJS.ShapeType, { x: x - bh / 2, y: by, w: bh, h: bh, fill: { color: b.overdue ? RED : theme.brand }, line: { type: "none" } });
            return;
          }
          const x1 = X(b.start);
          const w = Math.max(0.06, X(b.end + 1) - x1);
          s.addShape("roundRect" as PptxGenJS.ShapeType, { x: x1, y: by, w, h: bh, rectRadius: Math.min(0.06, bh / 2), fill: { color: theme.soft }, line: b.overdue ? { color: RED, width: 1.25 } : { type: "none" } });
          if (b.percent > 0) s.addShape("roundRect" as PptxGenJS.ShapeType, { x: x1, y: by, w: Math.max(0.04, (w * Math.min(100, b.percent)) / 100), h: bh, rectRadius: Math.min(0.06, bh / 2), fill: { color: theme.brand }, line: { type: "none" } });
          const pct = `${b.percent} %`;
          if (X(b.end + 1) + 0.55 < gx + gw) s.addText(pct, { x: X(b.end + 1) + 0.05, y, w: 0.6, h: rowH, fontFace: FONT, fontSize: 9, color: MUTED, margin: 0, valign: "middle" });
          else if (w > 0.6) s.addText(pct, { x: x1, y: by, w: w - 0.05, h: bh, fontFace: FONT, fontSize: 9, bold: true, color: theme.onBrand, align: "right", margin: 0, valign: "middle" });
        });
        if (todayN >= min && todayN <= max) {
          const x = X(todayN + 0.5);
          s.addShape("line" as PptxGenJS.ShapeType, { x, y: headY + 0.32, w: 0, h: gridBottom - headY - 0.32, line: { color: RED, width: 1.5, dashType: "dash" } });
          s.addText("Aujourd'hui", { x: x - 0.6, y: gridBottom + 0.02, w: 1.2, h: 0.22, fontFace: FONT, fontSize: 9, bold: true, color: RED, align: "center", margin: 0 });
        }
        reach(ctx, gridBottom + 0.25);
        s.addText(
          [
            { text: "■ ", options: { color: theme.brand } }, { text: "réalisé   ", options: { color: MUTED } },
            { text: "■ ", options: { color: theme.soft } }, { text: "reste à faire   ", options: { color: MUTED } },
            { text: "□ ", options: { color: RED } }, { text: "échéance dépassée   ", options: { color: MUTED } },
            { text: "◆ ", options: { color: theme.brand } }, { text: "jalon (une seule date)", options: { color: MUTED } },
          ],
          { x: MX, y: gridBottom + 0.02, w: 6.5, h: 0.22, fontFace: FONT, fontSize: 9, margin: 0 },
        );
      }
      flexComment(ctx, s, "respect du calendrier, glissements, jalons à venir et dates à reconfirmer…", undefined, 1.0);
    });
  }

  // --- 5. Points d'attention
  {
    const s = contentSlide(ctx, "Points d'attention", `${plural(late.length, "tâche")} en retard · ${plural(critical.length, "tâche critique", "tâches critiques")} ouverte${critical.length > 1 ? "s" : ""} · ${plural(blocked.length, "tâche bloquée", "tâches bloquées")}`);
    const tw = 8.55;
    const tableBottom = BOTTOM - 1.45;
    const top = late.slice(0, 10);
    s.addText("Tâches les plus en retard", { x: MX, y: TOP - 0.05, w: tw, h: 0.3, fontFace: FONT, fontSize: 13, bold: true, color: TEXT, margin: 0 });
    if (!top.length) emptyState(ctx, s, { x: MX, y: TOP + 0.3, w: tw, h: 1.1 }, "Aucune tâche en retard.");
    else {
      table(
        ctx, s, MX, TOP + 0.3,
        [
          { label: "Tâche", w: 3.2 },
          { label: "Étape", w: 1.85 },
          { label: "Responsable", w: 1.5 },
          { label: "Échéance", w: 1.0, align: "center" },
          { label: "Retard", w: 1.0, align: "center" },
        ],
        top.map(({ task, stage }) => [
          clean(task.name, 60),
          clean(stage, 34) || "—",
          clean(memberName(task.assigneeId), 26) || { text: "Non affectée", color: FAINT },
          fmtDay(task.dueDate),
          { text: `${nf.format(lateDays(task))} j`, tone: lateDays(task) > 30 ? "red" : "orange" },
        ]),
        Math.min(0.36, (tableBottom - TOP - 0.3) / (top.length + 1)),
      );
      moreNote(ctx, s, MX, tw, late.length - top.length, "autre tâche en retard", "autres tâches en retard");
    }
    // Colonne de droite : compteurs + tâches critiques / bloquées.
    const rx = MX + tw + 0.25;
    const rw = MX + CW - rx;
    const stats: Array<[string, string, string]> = [
      [nf.format(late.length), "En retard", late.length ? RED : GREEN],
      [nf.format(critical.length), "Critiques", critical.length ? AMBER : GREEN],
      [nf.format(blocked.length), "Bloquées", blocked.length ? AMBER : GREEN],
    ];
    const sw = (rw - 0.2) / 3;
    stats.forEach(([v, l, c], i) => {
      const x = rx + i * (sw + 0.1);
      s.addShape("roundRect" as PptxGenJS.ShapeType, { x, y: TOP - 0.05, w: sw, h: 0.95, rectRadius: 0.08, fill: { color: WHITE }, line: { color: LINE, width: 0.75 } });
      s.addText([{ text: v, options: { fontSize: 22, bold: true, color: c, breakLine: true } }, { text: l, options: { fontSize: 9.5, color: MUTED } }], { x, y: TOP - 0.05, w: sw, h: 0.95, fontFace: FONT, align: "center", valign: "middle", margin: 0 });
    });
    const byDue = (a: TaskRef, b: TaskRef) => (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999");
    const watch = [
      ...[...critical].sort(byDue).map((t) => ({ ...t, why: "Critique" })),
      ...blocked.filter((b) => b.task.priority !== "CRITICAL").sort(byDue).map((t) => ({ ...t, why: "Bloquée" })),
    ].slice(0, 6);
    const ly = TOP + 1.05;
    s.addText("Tâches critiques et bloquées", { x: rx, y: ly, w: rw, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: TEXT, margin: 0 });
    reach(ctx, ly + 0.32 + Math.max(1, watch.length) * 0.3);
    if (!watch.length) s.addText("Aucune tâche critique ni bloquée.", { x: rx, y: ly + 0.32, w: rw, h: 0.4, fontFace: FONT, fontSize: 11, italic: true, color: MUTED, margin: 0 });
    else
      s.addText(
        watch.map((w, i) => ({
          text: `${w.why === "Critique" ? "▲" : "⏸"}  ${clean(w.task.name, 52)}${w.task.dueDate ? ` — ${fmtDay(w.task.dueDate)}` : ""}`,
          options: { color: w.why === "Critique" ? RED : TEXT, fontSize: 10, breakLine: i < watch.length - 1 },
        })),
        { x: rx, y: ly + 0.32, w: rw, h: tableBottom - ly - 0.32, fontFace: FONT, valign: "top", paraSpaceAfter: 4, margin: 0, fit: "shrink" },
      );
    flexComment(ctx, s, "actions correctives engagées, responsables et dates cibles, besoins d'arbitrage…", "Actions correctives");
  }

  // --- 6. Risques et opportunités
  {
    const order = { OPEN: 0, MONITORING: 1, TREATED: 2, CLOSED: 3 } as Record<string, number>;
    const sorted = [...risks].sort((a, b) => (a.status === "CLOSED" ? 1 : 0) - (b.status === "CLOSED" ? 1 : 0) || b.score - a.score || order[a.status] - order[b.status]);
    const { pages, rest } = chunk(sorted, 8, 3);
    pages.forEach((page, pi) => {
      const s = contentSlide(ctx, pageTitle("Risques et opportunités", pi, pages.length), `${plural(openRisks.length, "risque ouvert", "risques ouverts")} · ${plural(openOpps.length, "opportunité ouverte", "opportunités ouvertes")} · ${plural(risks.length, "élément")} au registre`);
      const tw = 9.0;
      const tableBottom = BOTTOM - 1.45;
      if (!page.length) return emptyBody(ctx, s, "Aucun risque ni opportunité déclaré.", "risques identifiés hors registre, points de vigilance, opportunités à saisir…");
      else {
        table(
          ctx, s, MX, TOP,
          [
            { label: "", w: 0.42, align: "center" },
            { label: "Intitulé", w: 3.2 },
            { label: "Criticité", w: 1.15, align: "center" },
            { label: "Statut", w: 1.3, align: "center" },
            { label: "Stratégie", w: 1.6 },
            { label: "Responsable", w: 1.33 },
          ],
          page.map((r) => {
            const fill = (r.kind === "RISK" ? RISK_FILL : OPP_FILL)[r.level];
            return [
              { text: r.kind === "RISK" ? "R" : "O", bold: true, color: r.kind === "RISK" ? RED : "0F766E" },
              clean(r.title, 60),
              { text: `${r.score} · ${r.levelLabel}`, color: fill[1], fill: fill[0], bold: true },
              { text: RISK_STATUS_LABEL[r.status] ?? r.status, tone: RISK_STATUS_TONE[r.status] ?? "grey" },
              r.strategy ? STRATEGY_LABEL[r.kind][r.strategy] : { text: "À définir", color: FAINT },
              clean(r.ownerName, 24) || "—",
            ];
          }),
          Math.min(0.42, (tableBottom - TOP) / (page.length + 1)),
        );
        if (pi === pages.length - 1) moreNote(ctx, s, MX, tw, rest, "élément");
      }
      // Matrice 5×5 des risques non clos (probabilité × gravité).
      const mx = MX + tw + 0.6;
      const cell = Math.min(0.5, (MX + CW - mx) / 5);
      const my = TOP + 0.35;
      s.addText("Matrice des risques non clos", { x: mx - 0.45, y: TOP - 0.05, w: 5 * cell + 0.45, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: TEXT, margin: 0, align: "center" });
      const count = new Map<string, number>();
      for (const r of openRisks) count.set(`${r.probability}:${r.impact}`, (count.get(`${r.probability}:${r.impact}`) ?? 0) + 1);
      for (let p = 5; p >= 1; p--)
        for (let i = 1; i <= 5; i++) {
          const n = count.get(`${p}:${i}`) ?? 0;
          const [fill, ink] = RISK_FILL[riskLevel(p * i)];
          s.addText(n ? String(n) : "", {
            x: mx + (i - 1) * cell, y: my + (5 - p) * cell, w: cell, h: cell,
            shape: "rect" as PptxGenJS.ShapeType, fill: { color: fill }, line: { color: WHITE, width: 1.5 },
            fontFace: FONT, fontSize: 13, bold: true, color: ink, align: "center", valign: "middle", margin: 0,
          });
        }
      s.addText("Probabilité →", { x: mx - 0.32, y: my, w: 0.26, h: 5 * cell, fontFace: FONT, fontSize: 9, color: MUTED, vert: "vert270", align: "center", valign: "middle", margin: 0 });
      s.addText("Gravité →", { x: mx, y: my + 5 * cell + 0.03, w: 5 * cell, h: 0.25, fontFace: FONT, fontSize: 9, color: MUTED, align: "center", margin: 0 });
      reach(ctx, my + 5 * cell + 0.3);
      flexComment(ctx, s, "risques majeurs, évolution depuis le dernier point, plans de traitement, opportunités à saisir…");
    });
  }

  // --- 7. Livrables
  {
    const { pages, rest } = chunk(deliverables, 10, 4);
    const lateN = deliverables.filter(deliverableLate).length;
    pages.forEach((page, pi) => {
      const s = contentSlide(ctx, pageTitle("Livrables", pi, pages.length), deliverables.length ? `${delivered}/${deliverables.length} livrés ou validés · ${plural(lateN, "livrable")} en retard` : undefined);
      const tableBottom = BOTTOM - 1.45;
      if (!page.length) return emptyBody(ctx, s, "Aucun livrable déclaré.", "livrables attendus, jalons de livraison, critères de validation…");
      else {
        table(
          ctx, s, MX, TOP,
          [
            { label: "Livrable", w: 4.3 },
            { label: "Étape", w: 2.35 },
            { label: "Responsable", w: 1.75 },
            { label: "Statut", w: 1.3, align: "center" },
            { label: "Fin prévue", w: 1.25, align: "center" },
            { label: "Retard", w: 1.38, align: "center" },
          ],
          page.map((d) => {
            const isLateD = deliverableLate(d);
            return [
              clean(d.name, 70),
              (d.stageId ? clean(stageName.get(d.stageId), 36) : "") || "—",
              clean(memberName(d.assigneeId), 26) || "—",
              { text: DELIVERABLE_STATUS[d.status] ?? d.status, tone: DELIVERABLE_TONE[d.status] ?? "grey" },
              fmtDay(d.expectedEnd),
              isLateD ? { text: `${nf.format(todayN - dayNum(d.expectedEnd!.slice(0, 10)))} j`, tone: "red" } : { text: "—", color: FAINT },
            ];
          }),
          Math.min(0.38, (tableBottom - TOP) / (page.length + 1)),
        );
        if (pi === pages.length - 1) moreNote(ctx, s, MX, CW, rest, "livrable");
      }
      flexComment(ctx, s, "livrables attendus, validations en cours, qualité, livrables à risque…");
    });
  }

  // --- 8. Réunions et décisions
  {
    const recent = [...meetings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    const pendingN = meetings.filter((m) => m.status === "pending").length;
    const s = contentSlide(ctx, "Réunions et décisions", meetings.length ? `${plural(meetings.length, "réunion")} · ${plural(pendingN, "compte-rendu", "comptes-rendus")} en attente de validation` : undefined);
    const tableBottom = BOTTOM - 1.45;
    const prompt = "décisions prises, décisions attendues, gouvernance et prochaines instances…";
    if (!recent.length) emptyBody(ctx, s, "Aucune réunion enregistrée.", prompt, "Décisions et gouvernance");
    else {
      table(
        ctx, s, MX, TOP,
        [
          { label: "Date", w: 1.25, align: "center" },
          { label: "Réunion", w: 4.6 },
          { label: "Rédacteur", w: 1.9 },
          { label: "Participants", w: 1.25, align: "center" },
          { label: "Compte-rendu", w: 1.65, align: "center" },
          { label: "Validations", w: 1.68, align: "center" },
        ],
        recent.map((m) => {
          const ok = m.approvers.filter((a) => a.decision === "APPROVED").length;
          const ko = m.approvers.filter((a) => a.decision === "REJECTED").length;
          return [
            fmtDay(m.date),
            clean(m.title, 70),
            clean(m.authorName, 26) || "—",
            nf.format(m.participants.length),
            { text: MEETING_STATUS[m.status] ?? m.status, tone: MEETING_TONE[m.status] ?? "grey" },
            m.approvers.length ? `${ok}/${m.approvers.length} validé${ok > 1 ? "s" : ""}${ko ? ` · ${ko} refus` : ""}` : { text: "—", color: FAINT },
          ];
        }),
        Math.min(0.38, (tableBottom - TOP) / (recent.length + 1)),
      );
      if (meetings.length > recent.length) moreNote(ctx, s, MX, CW, meetings.length - recent.length, "réunion plus ancienne", "réunions plus anciennes");
      flexComment(ctx, s, prompt, "Décisions et gouvernance");
    }
  }

  // --- 9. Équipe
  {
    type Load = { id: string; name: string; role: string; open: number; late: number; done: number };
    const load = new Map<string, Load>(project.members.map((m) => [m.id, { id: m.id, name: m.name, role: m.role ?? "", open: 0, late: 0, done: 0 }]));
    let unassigned = 0;
    for (const { task } of tasks) {
      const l = task.assigneeId ? load.get(task.assigneeId) : undefined;
      if (!l) {
        if (!isClosed(task)) unassigned++;
        continue;
      }
      if (isClosed(task)) l.done++;
      else {
        l.open++;
        if (lateDays(task) > 0) l.late++;
      }
    }
    const rows = [...load.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "fr"));
    const { pages, rest } = chunk(rows, 12, 3);
    pages.forEach((page, pi) => {
      const s = contentSlide(ctx, pageTitle("Équipe et charge", pi, pages.length), `${plural(project.members.length, "membre")} · ${plural(unassigned, "tâche ouverte", "tâches ouvertes")} non affectée${unassigned > 1 ? "s" : ""}`);
      const tableBottom = BOTTOM - 1.45;
      if (!page.length) return emptyBody(ctx, s, "Aucun membre dans l'équipe.", "composition de l'équipe, ressources attendues, organisation…");
      else {
        const tw = 7.0;
        table(
          ctx, s, MX, TOP,
          [
            { label: "Membre", w: 2.5 },
            { label: "Rôle", w: 1.75 },
            { label: "Ouvertes", w: 0.95, align: "center" },
            { label: "En retard", w: 0.95, align: "center" },
            { label: "Terminées", w: 0.85, align: "center" },
          ],
          page.map((l) => [
            { text: clean(l.name, 34), bold: true },
            clean(l.role, 26) || "—",
            nf.format(l.open),
            l.late ? { text: nf.format(l.late), tone: "red" } : { text: "0", color: FAINT },
            nf.format(l.done),
          ]),
          Math.min(0.38, (tableBottom - TOP) / (page.length + 1)),
        );
        if (pi === pages.length - 1) moreNote(ctx, s, MX, tw, rest, "membre");
        // Barres horizontales : PowerPoint trace la première catégorie en bas.
        const chartRows = page.filter((l) => l.open + l.done > 0).reverse();
        const cx = MX + tw + 0.25;
        const maxOpen = Math.max(1, ...chartRows.map((l) => l.open));
        const teamChartH = Math.min(tableBottom - TOP + 0.1, 0.45 * chartRows.length + 1.1);
        if (chartRows.length) reach(ctx, TOP - 0.1 + teamChartH);
        if (chartRows.length)
          s.addChart(
            pptx.ChartType.bar,
            [
              { name: "Dans les délais", labels: chartRows.map((l) => clean(l.name, 22)), values: chartRows.map((l) => l.open - l.late) },
              { name: "En retard", labels: chartRows.map((l) => clean(l.name, 22)), values: chartRows.map((l) => l.late) },
            ],
            {
              x: cx, y: TOP - 0.1, w: MX + CW - cx, h: teamChartH,
              barDir: "bar", barGrouping: "stacked", barGapWidthPct: 50,
              valAxisMinVal: 0, valAxisMajorUnit: niceStep(maxOpen / 6), valAxisLabelFormatCode: "0",
              chartColors: [theme.brand, RED],
              catAxisLabelFontSize: 10, catAxisLabelColor: TEXT, catAxisLabelFontFace: FONT, catAxisLineShow: false,
              valAxisLabelFontSize: 9, valAxisLabelColor: MUTED, valGridLine: { color: LINE, size: 0.5 },
              showLegend: true, legendPos: "t", legendFontSize: 10, legendFontFace: FONT,
              showTitle: true, title: "Tâches ouvertes par membre", titleFontSize: 12, titleColor: TEXT, titleFontFace: FONT,
            },
          );
        else emptyState(ctx, s, { x: cx, y: TOP, w: MX + CW - cx, h: 1.1 }, "Aucune tâche affectée.");
      }
      flexComment(ctx, s, "charge et disponibilité, renforts ou départs, points d'organisation…");
    });
  }

  // --- 10. Prochaines étapes (30 jours)
  {
    const horizon = todayN + 30;
    type Due = { kind: string; name: string; context: string; who: string; due: string };
    const upcoming: Due[] = [];
    for (const { task, stage } of tasks) {
      if (isClosed(task) || !task.dueDate) continue;
      const n = dayNum(task.dueDate.slice(0, 10));
      if (n >= todayN && n <= horizon) upcoming.push({ kind: "Tâche", name: task.name, context: stage, who: memberName(task.assigneeId), due: task.dueDate.slice(0, 10) });
    }
    for (const d of deliverables) {
      if (d.status === "DELIVERED" || d.status === "VALIDATED" || !d.expectedEnd) continue;
      const n = dayNum(d.expectedEnd.slice(0, 10));
      if (n >= todayN && n <= horizon) upcoming.push({ kind: "Livrable", name: d.name, context: d.stageId ? (stageName.get(d.stageId) ?? "") : "", who: memberName(d.assigneeId), due: d.expectedEnd.slice(0, 10) });
    }
    for (const st of project.stages) {
      if (!st.dueDate || st.progress.percent >= 100) continue;
      const n = dayNum(st.dueDate.slice(0, 10));
      if (n >= todayN && n <= horizon) upcoming.push({ kind: "Étape", name: st.name, context: "Fin d'étape", who: "", due: st.dueDate.slice(0, 10) });
    }
    const kindRank: Record<string, number> = { Étape: 0, Livrable: 1, Tâche: 2 };
    upcoming.sort((a, b) => a.due.localeCompare(b.due) || kindRank[a.kind] - kindRank[b.kind]);
    const shown = upcoming.slice(0, 9);
    const s = contentSlide(ctx, "Prochaines étapes", `${plural(upcoming.length, "échéance")} dans les 30 prochains jours`);
    const tw = 7.6;
    if (!shown.length) emptyState(ctx, s, { x: MX, y: TOP, w: tw, h: 1.1 }, "Aucune échéance dans les 30 prochains jours.");
    else {
      const KIND_TONE: Record<string, string> = { Étape: "violet", Livrable: "teal", Tâche: "blue" };
      table(
        ctx, s, MX, TOP,
        [
          { label: "Échéance", w: 1.05, align: "center" },
          { label: "Type", w: 0.95, align: "center" },
          { label: "Intitulé", w: 3.25 },
          { label: "Responsable", w: 1.45 },
          { label: "Dans", w: 0.9, align: "center" },
        ],
        shown.map((u) => {
          const inDays = dayNum(u.due) - todayN;
          return [
            fmtDay(u.due),
            { text: u.kind, tone: KIND_TONE[u.kind] },
            clean(u.name, 55),
            clean(u.who, 22) || "—",
            { text: inDays === 0 ? "auj." : `${inDays} j`, color: inDays <= 7 ? AMBER : TEXT, bold: inDays <= 7 },
          ];
        }),
        Math.min(0.5, (BOTTOM - TOP - 0.3) / (shown.length + 1)),
      );
      moreNote(ctx, s, MX, tw, upcoming.length - shown.length, "autre échéance", "autres échéances");
    }
    const cx = MX + tw + 0.25;
    commentBox(s, { x: cx, y: TOP, w: MX + CW - cx, h: BOTTOM - TOP }, "prochaines étapes, décisions attendues du comité, demandes d'arbitrage ou de moyens, prochain point d'étape…", "Prochaines étapes et décisions attendues");
  }

  const out = (await pptx.write({ outputType: "nodebuffer", compression: true })) as Buffer;
  const safe = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "projet";
  return { buffer: Buffer.from(out), filename: `${safe}-etat-des-lieux-${today}.pptx` };
}
