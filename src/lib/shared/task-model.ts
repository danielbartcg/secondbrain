/**
 * Règles pures sur les tâches (sans accès base), partagées par le serveur
 * (src/lib/tasks.ts les réexporte) et le client hors ligne (native/).
 */

export const NO_PROJECT_LABEL = "Sans projet";

const MENTION_RE = /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g;
const BARE_MENTION_RE = /@\[([^\]]+)\](?!\()/g;

/**
 * Normalise les mentions d'un commentaire : `@[Nom]` (tel que saisi dans
 * l'interface) devient `@[Nom](memberId)` si un membre du projet porte ce nom
 * (insensible à la casse) ; les identifiants déjà présents sont vérifiés.
 * Renvoie le corps normalisé et les membres effectivement mentionnés.
 */
export function resolveMentions(body: string, members: Array<{ id: string; name: string }>): { body: string; mentions: string[] } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m]));
  const ids = new Set<string>();
  let out = body.replace(BARE_MENTION_RE, (whole, name: string) => {
    const m = byName.get(name.trim().toLowerCase());
    if (!m) return whole;
    ids.add(m.id);
    return `@[${m.name}](${m.id})`;
  });
  out = out.replace(MENTION_RE, (whole, name: string, id: string) => {
    const m = byId.get(id);
    if (!m) return `@[${name}]`;
    ids.add(m.id);
    return `@[${m.name}](${m.id})`;
  });
  return { body: out, mentions: [...ids] };
}

/** `Date` (colonne DATE, minuit UTC) → `AAAA-MM-JJ`. */
export const dayString = (d: Date) => d.toISOString().slice(0, 10);
