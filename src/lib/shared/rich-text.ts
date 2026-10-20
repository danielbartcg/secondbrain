/**
 * Texte riche (règles pures, sans assainisseur : utilisables dans le
 * navigateur). Les anciennes descriptions de tâche et les anciens
 * commentaires sont en texte brut : convertis en paragraphes à l'affichage.
 * L'assainissement (sanitizeNotes) se fait côté serveur / modèle local
 * (`src/lib/rich-text.ts`).
 */

/** Une chaîne est-elle du HTML (l'éditeur riche commence toujours par une balise) ? Sinon : ancien texte brut. */
export function looksLikeHtml(s: string): boolean {
  return /^\s*<[a-z][a-z0-9]*[\s>/]/i.test(s);
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texte brut → paragraphes HTML (lignes vides = paragraphes, retours à la ligne conservés). */
export function textToParagraphs(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Valeur initiale d'un éditeur riche : HTML tel quel, texte brut converti. */
export const editorHtml = (v: string | null | undefined) => (!v ? "" : looksLikeHtml(v) ? v : textToParagraphs(v));
