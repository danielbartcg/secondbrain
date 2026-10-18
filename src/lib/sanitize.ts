import sanitizeHtml from "sanitize-html";
import { OBJECT_REF_RE } from "./shared/links";

/**
 * Assainissement du HTML produit par l'éditeur de notes (TipTap).
 * Appliqué à l'enregistrement ET au rendu : jamais l'un sans l'autre.
 *
 * Les images ne peuvent pointer que vers nos médias (/media/…) ou une URL
 * https (pas http : contenu mixte, pistage en clair) ; pas de data: ni de
 * blob: (une URL blob n'a de sens que dans l'onglet qui l'a créée ; elle ne doit jamais être persistée).
 */
/**
 * Lien vers un objet de l'application (`[[…]]` dans l'éditeur) : `data-ref`
 * = « kind:id », lu par les rétroliens et le graphe de connaissances
 * (`src/lib/links.ts`). Toute autre valeur est retirée.
 */

/** Lien interne (chemin de l'application) : même onglet ; externe : nouvel onglet, sans référent. */
function transformLink(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const out: sanitizeHtml.Attributes = { ...attribs };
  if (out["data-ref"] !== undefined && !OBJECT_REF_RE.test(out["data-ref"])) delete out["data-ref"];
  if (/^\/(?!\/)/.test(out.href ?? "")) {
    delete out.target;
    out.rel = "noopener";
  } else {
    delete out["data-ref"];
    out.rel = "noopener noreferrer nofollow";
    out.target = "_blank";
  }
  return { tagName, attribs: out };
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
    "h1", "h2", "h3", "h4", "ul", "ol", "li", "a", "hr", "label", "div", "input", "span", "img",
    // Tableaux (éditeur riche) : structure seule, pas de style.
    "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "data-ref"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan", "colwidth"],
    th: ["colspan", "rowspan", "colwidth"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: transformLink,
    input: (tagName, attribs) =>
      attribs.type === "checkbox" ? { tagName, attribs } : { tagName: "span", attribs: {} },
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !isAllowedImageSrc(frame.attribs.src),
};

function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  if (src.startsWith("/media/")) return true;
  return /^https:\/\//i.test(src);
}

export function sanitizeNotes(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS);
}

/** Texte brut d'un HTML (extraits : notifications, aperçus de messages, e-mails). */
export function htmlToText(html: string, max = 200): string {
  const text = sanitizeHtml((html ?? "").replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, "$& "), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
