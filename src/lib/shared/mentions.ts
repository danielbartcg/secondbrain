/**
 * Mentions des commentaires (règles pures, partagées serveur / écrans /
 * application) : forme stockée `@[Nom](memberId)`, forme saisie `@[Nom]`.
 * Les pistes d'audit citent les commentaires avec leurs mentions
 * structurées : à l'affichage, une mention devient « @Nom » (pastille dans
 * l'interface, texte simple pour le connecteur MCP, les notifications et les
 * e-mails), jamais l'identifiant.
 *
 * Ancienne forme (pistes d'audit écrites avant le 19/10/2026) :
 * `@Nom(memberId)` — reconnue aussi, identifiants `pm_…` ou cuid.
 */

/** `@[Nom](id)`, `@[Nom]` ou l'ancienne forme `@Nom(id)`. */
export const MENTION_TOKEN_RE = /@\[([^\]\n]+)\](?:\(([A-Za-z0-9_-]+)\))?|@([^@()\n«»"]{1,80}?)\((pm_[0-9a-f]{8,}|c[a-z0-9]{20,})\)/g;

export type MentionSegment = { kind: "text"; text: string } | { kind: "mention"; name: string; id: string | null; raw: string };

/** Découpe un texte en morceaux de texte et mentions. */
export function mentionSegments(text: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: text.slice(last, idx) });
    out.push({ kind: "mention", name: (m[1] ?? m[3]).trim(), id: m[2] ?? m[4] ?? null, raw: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Mentions rendues lisibles en texte simple : `@[Nom](id)` → `@Nom`. */
export function plainMentions(text: string): string {
  return mentionSegments(text)
    .map((p) => (p.kind === "text" ? p.text : `@${p.name}`))
    .join("");
}

/**
 * Extrait d'un commentaire pour une piste d'audit : espaces normalisés,
 * longueur visible (« @Nom ») bornée à `max`, mentions structurées
 * conservées entières (jamais coupées au milieu).
 */
export function mentionExcerpt(text: string, max = 120): string {
  const parts = mentionSegments(text.replace(/\s+/g, " ").trim());
  let out = "";
  let visible = 0;
  for (const p of parts) {
    const shown = p.kind === "text" ? p.text : `@${p.name}`;
    if (visible + shown.length <= max - 1 || (visible + shown.length <= max && p === parts[parts.length - 1])) {
      out += p.kind === "text" ? p.text : p.raw;
      visible += shown.length;
      continue;
    }
    if (p.kind === "text") out += p.text.slice(0, Math.max(0, max - 1 - visible));
    return out.trimEnd() + "…";
  }
  return out;
}
