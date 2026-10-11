import sanitizeHtml from "sanitize-html";

/**
 * Assainissement du HTML produit par l'éditeur de notes (TipTap).
 * Appliqué à l'enregistrement ET au rendu : jamais l'un sans l'autre.
 *
 * Les images ne peuvent pointer que vers nos médias (/media/…) ou une URL
 * http(s) : pas de data: ni de blob: (une URL blob n'a de sens que dans
 * l'onglet qui l'a créée ; elle ne doit jamais être persistée).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
    "h1", "h2", "h3", "h4", "ul", "ol", "li", "a", "hr", "label", "div", "input", "span", "img",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked"],
    img: ["src", "alt", "title", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
    input: (tagName, attribs) =>
      attribs.type === "checkbox" ? { tagName, attribs } : { tagName: "span", attribs: {} },
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !isAllowedImageSrc(frame.attribs.src),
};

function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  if (src.startsWith("/media/")) return true;
  return /^https?:\/\//i.test(src);
}

export function sanitizeNotes(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS);
}
