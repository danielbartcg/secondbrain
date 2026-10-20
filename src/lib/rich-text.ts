import { sanitizeNotes, htmlToText } from "@/lib/sanitize";
import { looksLikeHtml, textToParagraphs } from "@/lib/shared/rich-text";

export { looksLikeHtml, textToParagraphs };

/**
 * Texte riche des descriptions de tâche et des commentaires (serveur et
 * application native — pas de « server-only »). Les anciennes données sont
 * en texte brut : elles sont converties en paragraphes à la lecture ; toute
 * valeur HTML est assainie (sanitizeNotes) à l'écriture et à la lecture.
 */

/** Valeur stockable : HTML assaini (texte brut converti) ; `undefined` conservé (champ non modifié). */
export function richDescription(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const html = sanitizeNotes(looksLikeHtml(v) ? v : textToParagraphs(v));
  return htmlToText(html, 10).length || html.includes("<img") ? html : "";
}

/** HTML affichable (assaini) d'une description ou d'un commentaire, ancien texte brut compris. */
export function richHtml(v: string | null | undefined): string {
  if (!v) return "";
  return sanitizeNotes(looksLikeHtml(v) ? v : textToParagraphs(v));
}

/** Texte brut (exports, connecteur MCP, extraits). */
export function richText(v: string | null | undefined, max = 100_000): string {
  if (!v) return "";
  return looksLikeHtml(v) ? htmlToText(v, max) : v.length > max ? v.slice(0, max - 1) + "…" : v;
}
