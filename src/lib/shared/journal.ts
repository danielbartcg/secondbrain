/**
 * Journal quotidien (règles pures : serveur, écrans, application, connecteur
 * MCP). Sept blocs rédigés (texte riche) et un bloc « Activité » calculé
 * depuis les pistes d'audit. Chaque utilisateur choisit les blocs affichés
 * (Préférences → Personnalisation du journal).
 */

export const JOURNAL_WRITTEN_BLOCKS = ["SUMMARY", "POSITIVE", "NEGATIVE", "ACHIEVEMENTS", "REGRETS", "HABITS", "IMPROVEMENT"] as const;
export type JournalWrittenBlock = (typeof JOURNAL_WRITTEN_BLOCKS)[number];
export const JOURNAL_BLOCKS = [...JOURNAL_WRITTEN_BLOCKS, "ACTIVITY"] as const;
export type JournalBlockKey = (typeof JOURNAL_BLOCKS)[number];

export const JOURNAL_BLOCK_LABEL: Record<JournalBlockKey, string> = {
  SUMMARY: "Résumé de la journée",
  POSITIVE: "Pensées positives du jour",
  NEGATIVE: "Pensées négatives",
  ACHIEVEMENTS: "Réalisations",
  REGRETS: "Regrets",
  HABITS: "Habitudes et routines",
  IMPROVEMENT: "Amélioration continue",
  ACTIVITY: "Activité",
};

export const JOURNAL_BLOCK_HINT: Record<JournalBlockKey, string> = {
  SUMMARY: "Ce qui a marqué la journée, en quelques lignes.",
  POSITIVE: "Ce qui vous a fait du bien, ce dont vous êtes reconnaissant.",
  NEGATIVE: "Ce qui vous a pesé ou contrarié.",
  ACHIEVEMENTS: "Ce que vous avez accompli, petit ou grand.",
  REGRETS: "Ce que vous auriez aimé faire autrement.",
  HABITS: "Routines tenues ou manquées : sport, sommeil, lecture…",
  IMPROVEMENT: "Ce que vous changerez demain.",
  ACTIVITY: "Rempli automatiquement depuis l'historique de vos tâches et cartes mentales.",
};

export const isJournalBlock = (v: unknown): v is JournalBlockKey => typeof v === "string" && (JOURNAL_BLOCKS as readonly string[]).includes(v);
export const isWrittenBlock = (v: unknown): v is JournalWrittenBlock => typeof v === "string" && (JOURNAL_WRITTEN_BLOCKS as readonly string[]).includes(v);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Clé d'un bloc depuis sa clé ou son libellé, même approximatif (« pensées positives », « regrets »…). */
export function resolveJournalBlock(ref: string): JournalBlockKey | null {
  const up = ref.trim().toUpperCase();
  if (isJournalBlock(up)) return up;
  const q = fold(ref);
  if (!q) return null;
  const exact = JOURNAL_BLOCKS.find((b) => fold(JOURNAL_BLOCK_LABEL[b]) === q);
  if (exact) return exact;
  const starts = JOURNAL_BLOCKS.filter((b) => fold(JOURNAL_BLOCK_LABEL[b]).includes(q) || q.includes(fold(JOURNAL_BLOCK_LABEL[b])));
  if (starts.length === 1) return starts[0];
  const ALIASES: [RegExp, JournalBlockKey][] = [
    [/resume|bilan|synthese/, "SUMMARY"],
    [/positi|gratitude|reconnaiss/, "POSITIVE"],
    [/negati/, "NEGATIVE"],
    [/realis|accompli|reussite/, "ACHIEVEMENTS"],
    [/regret/, "REGRETS"],
    [/habitude|routine/, "HABITS"],
    [/amelior|progres/, "IMPROVEMENT"],
    [/activit/, "ACTIVITY"],
  ];
  return ALIASES.find(([re]) => re.test(q))?.[1] ?? null;
}

/** Blocs activés d'un profil, dans l'ordre canonique (valeurs inconnues ignorées). */
export function normalizeJournalBlocks(raw: readonly string[] | null | undefined): JournalBlockKey[] {
  const set = new Set(raw ?? JOURNAL_BLOCKS);
  return JOURNAL_BLOCKS.filter((b) => set.has(b));
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-JJ valide (date réelle). */
export function isValidDay(v: string): boolean {
  if (!DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Décale un jour AAAA-MM-JJ. */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** « lundi 19 octobre 2026 ». */
export function formatJournalDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export type JournalEntryDto = { day: string; block: JournalWrittenBlock; content: string; createdAt: string; updatedAt: string };
export type JournalActivityItem = { at: string; kind: "task" | "map" | "risk"; objectId: string; objectName: string; context: string | null; message: string };
export type JournalDayDto = { day: string; entries: JournalEntryDto[]; activity: JournalActivityItem[]; blocks: JournalBlockKey[] };
export type JournalReportDto = {
  block: JournalBlockKey;
  from: string;
  to: string;
  /** Blocs rédigés : une saisie par jour renseigné (plus récent d'abord). */
  entries: JournalEntryDto[];
  /** Bloc « Activité » : événements par jour (plus récent d'abord). */
  activityDays: { day: string; count: number; items: JournalActivityItem[] }[];
  /** Série quotidienne pour le graphique (mots saisis, ou nombre d'événements). */
  series: { day: string; value: number }[];
};

/** Nombre de mots d'un texte. */
export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
