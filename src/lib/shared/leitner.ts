/**
 * Résurgence : répétition espacée des notes (boîtes de Leitner), règles pures
 * partagées. Chaque note relue passe dans une boîte : « toujours utile » la
 * fait monter (elle revient plus tard), « à revoir bientôt » la renvoie en
 * boîte 1, « ne plus proposer » l'archive.
 */

export const LEITNER_BOXES = 5;
/** Intervalle avant le prochain passage, par boîte (jours). */
export const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 3, 2: 10, 3: 30, 4: 90, 5: 180 };
/** Nombre de notes proposées par jour. */
export const DAILY_COUNT = 3;
/** Une note n'est proposée pour la première fois qu'après ce délai sans modification. */
export const MIN_AGE_DAYS = 30;

const DAY_MS = 86_400_000;

export type ResurfaceAnswer = "remember" | "again" | "archive";

export function reviewCard(box: number, answer: ResurfaceAnswer, now: Date): { box: number; dueAt: Date; archived: boolean } {
  const next = answer === "remember" ? Math.min(LEITNER_BOXES, Math.max(1, box) + 1) : 1;
  return { box: next, dueAt: new Date(now.getTime() + BOX_INTERVAL_DAYS[next] * DAY_MS), archived: answer === "archive" };
}

/** Jour de Paris (AAAA-MM-JJ) : la sélection change à minuit, heure française. */
export function parisDay(now: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Hachage FNV-1a 32 bits : ordre pseudo-aléatoire stable pour une graine. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mélange déterministe (même graine ⇒ même ordre, toute la journée). */
export function seededOrder<T>(items: T[], key: (x: T) => string, seed: string): T[] {
  return [...items].sort((a, b) => hash32(seed + key(a)) - hash32(seed + key(b)) || key(a).localeCompare(key(b)));
}

/**
 * Sélection du jour : d'abord les cartes échues (les plus en retard
 * d'abord), puis des notes jamais relues pour compléter, dans un ordre
 * pseudo-aléatoire propre à la journée et à l'utilisateur. Le quota du jour
 * diminue à chaque note relue aujourd'hui (la liste se vide au fil des
 * réponses, sans se regarnir). `cards` : toutes les cartes de l'utilisateur.
 */
export function pickDaily(
  cards: { ref: string; dueAt: Date; lastReviewedAt: Date | null; archived: boolean }[],
  fresh: string[],
  opts: { userId: string; now: Date; count?: number },
): string[] {
  const today = parisDay(opts.now);
  const reviewedToday = (d: Date | null) => !!d && parisDay(d) === today;
  const quota = Math.max(0, (opts.count ?? DAILY_COUNT) - cards.filter((c) => reviewedToday(c.lastReviewedAt)).length);
  if (quota === 0) return [];
  const picked = cards
    .filter((c) => !c.archived && c.dueAt.getTime() <= opts.now.getTime() && !reviewedToday(c.lastReviewedAt))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, quota)
    .map((c) => c.ref);
  const known = new Set(cards.map((c) => c.ref));
  for (const ref of seededOrder(fresh, (r) => r, `${opts.userId}:${today}:`)) {
    if (picked.length >= quota) break;
    if (!known.has(ref)) {
      picked.push(ref);
      known.add(ref);
    }
  }
  return picked;
}
