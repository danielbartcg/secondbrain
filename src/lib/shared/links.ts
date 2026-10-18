/**
 * Liens entre objets (`[[…]]` dans l'éditeur riche) : un lien est une ancre
 * `<a href="/tasks/…" data-ref="task:…">` ; `data-ref` (« kind:id ») est la
 * référence lue par les rétroliens et le graphe de connaissances, `href` la
 * page ouverte au clic. Règles pures partagées.
 */

export const LINK_KINDS = ["project", "stage", "activity", "task", "mindmap", "node", "meeting", "document"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const OBJECT_REF_RE = /^(project|stage|activity|task|mindmap|node|meeting|document):[A-Za-z0-9_-]{1,64}$/;

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  project: "Projet",
  stage: "Étape",
  activity: "Activité",
  task: "Tâche",
  mindmap: "Carte",
  node: "Nœud",
  meeting: "Réunion",
  document: "Document",
};

/** Couleur d'un type d'objet (graphe, pastilles). */
export const LINK_KIND_COLOR: Record<LinkKind, string> = {
  project: "#4f5ff0",
  stage: "#0ea5e9",
  activity: "#64748b",
  task: "#1f9d55",
  mindmap: "#8b5cf6",
  node: "#ec4899",
  meeting: "#d98a0b",
  document: "#d13b3b",
};

export function parseLinkRef(ref: string): { kind: LinkKind; id: string } | null {
  if (!OBJECT_REF_RE.test(ref)) return null;
  const i = ref.indexOf(":");
  return { kind: ref.slice(0, i) as LinkKind, id: ref.slice(i + 1) };
}

/** Références `data-ref` d'un HTML (uniques, dans l'ordre d'apparition). */
export function extractRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of (html ?? "").matchAll(/data-ref="([^"]{1,80})"/g)) {
    if (OBJECT_REF_RE.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Page ouverte par un lien vers un objet. */
export function linkHref(o: { kind: LinkKind; id: string; mapId?: string | null; projectId?: string | null }): string {
  switch (o.kind) {
    case "project":
      return `/projects/${o.id}`;
    case "task":
      return `/tasks/${o.id}`;
    case "mindmap":
      return `/mindmaps/${o.id}`;
    case "node":
      return `/mindmaps/${o.mapId}?node=${o.id}`;
    case "meeting":
      return `/projects/${o.projectId}?meeting=${o.id}#reunions`;
    case "document":
      return `/projects/${o.projectId}#documents`;
    case "stage":
    case "activity":
      return `/notes?ref=${encodeURIComponent(`${o.kind}:${o.id}`)}`;
  }
}

/** Texte autour d'un lien (aperçu « mentionné dans »), sans balises. */
export function linkContext(html: string, ref: string, radius = 140): string {
  const i = html.indexOf(`data-ref="${ref}"`);
  if (i < 0) return "";
  const raw = html.slice(Math.max(0, i - radius * 3), i + radius * 3);
  const text = raw
    .replace(/^[^<]*>/, "")
    .replace(/<[^>]*$/, "")
    .replace(/<\/(p|div|li|h[1-6]|td|th)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > radius * 2 ? "…" + text.slice(Math.max(0, Math.floor(text.length / 2) - radius), Math.floor(text.length / 2) + radius).trim() + "…" : text;
}
