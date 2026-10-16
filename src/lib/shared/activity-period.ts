/**
 * Fenêtres de temps du rapport d'activité (pur : serveur, interface,
 * application, connecteur MCP). Les jours sont ceux de Paris (Europe/Paris) ;
 * une période va de `from` (inclus, 00:00) à `to` (inclus, jusqu'à 23:59:59).
 */

export const ACTIVITY_PRESETS = [
  { key: "today", label: "Aujourd'hui" },
  { key: "yesterday", label: "Hier" },
  { key: "7d", label: "7 derniers jours" },
  { key: "week", label: "Cette semaine" },
  { key: "last_week", label: "Semaine dernière" },
  { key: "30d", label: "30 derniers jours" },
  { key: "month", label: "Ce mois-ci" },
  { key: "last_month", label: "Mois dernier" },
  { key: "quarter", label: "90 derniers jours" },
] as const;
export type ActivityPreset = (typeof ACTIVITY_PRESETS)[number]["key"];

/** Plus longue fenêtre acceptée (jours). */
export const MAX_ACTIVITY_DAYS = 366;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Date du jour (AAAA-MM-JJ) à Paris pour un instant donné. */
export function parisYmd(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Instant UTC de minuit (heure de Paris) du jour donné. */
export function parisMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Décalage de Paris à cet instant (1 h ou 2 h), en deux passes pour les changements d'heure.
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const v = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - t;
  };
  let t = utcGuess - offsetAt(utcGuess);
  t = utcGuess - offsetAt(t);
  return new Date(t);
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Bornes (AAAA-MM-JJ, incluses) d'une période prédéfinie. */
export function presetRange(preset: ActivityPreset, now: Date = new Date()): { from: string; to: string } {
  const today = parisYmd(now);
  const [y, m] = today.split("-").map(Number);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "week":
      return { from: addDays(today, -weekday), to: today };
    case "last_week":
      return { from: addDays(today, -weekday - 7), to: addDays(today, -weekday - 1) };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      return { from: first, to: addDays(`${today.slice(0, 7)}-01`, -1) };
    }
    case "quarter":
      return { from: addDays(today, -89), to: today };
  }
}

export type ActivityWindow = { from: string; to: string; start: Date; end: Date; label: string };

/**
 * Résout une demande (`period` prédéfinie, ou `from` / `to` libres) en
 * fenêtre validée. Par défaut : 7 derniers jours. Lève une erreur (message
 * français) si les dates sont invalides ou la fenêtre trop longue.
 */
export function resolveActivityWindow(input: { period?: string | null; from?: string | null; to?: string | null }, now: Date = new Date()): ActivityWindow {
  let from: string;
  let to: string;
  let label: string;
  const preset = ACTIVITY_PRESETS.find((p) => p.key === input.period);
  if (input.from || input.to) {
    from = input.from || input.to!;
    to = input.to || parisYmd(now);
    if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new Error("Dates au format AAAA-MM-JJ attendues.");
    if (from > to) [from, to] = [to, from];
    label = from === to ? `le ${fr(from)}` : `du ${fr(from)} au ${fr(to)}`;
  } else {
    if (input.period && !preset) throw new Error(`Période inconnue : ${input.period} (valeurs : ${ACTIVITY_PRESETS.map((p) => p.key).join(", ")}).`);
    const p = preset ?? ACTIVITY_PRESETS[2];
    ({ from, to } = presetRange(p.key, now));
    label = `${p.label} (${from === to ? fr(from) : `du ${fr(from)} au ${fr(to)}`})`;
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (days > MAX_ACTIVITY_DAYS) throw new Error(`Fenêtre trop longue (${days} jours, ${MAX_ACTIVITY_DAYS} au plus).`);
  return { from, to, start: parisMidnight(from), end: parisMidnight(addDays(to, 1)), label };
}

function fr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
