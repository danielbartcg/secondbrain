/**
 * Icônes des projets et des cartes mentales (règles pures) : bibliothèque
 * Lucide (« lucide:<nom> », plus de 2 000 icônes chargées à la demande) ou
 * icône personnalisée téléversée (« /media/… », images uniquement).
 */

export const LUCIDE_PREFIX = "lucide:";
export const ICON_RE = /^(lucide:[a-z0-9-]{1,60}|\/media\/[A-Za-z0-9/_-]+\.(png|jpe?g|gif|webp))$/;
export const MEDIA_IMAGE_RE = /^\/media\/[A-Za-z0-9/_-]+\.(png|jpe?g|gif|webp)$/;

export type IconRef = { kind: "lucide"; name: string } | { kind: "image"; url: string } | null;

export function parseIcon(v: string | null | undefined): IconRef {
  if (!v || !ICON_RE.test(v)) return null;
  return v.startsWith(LUCIDE_PREFIX) ? { kind: "lucide", name: v.slice(LUCIDE_PREFIX.length) } : { kind: "image", url: v };
}
