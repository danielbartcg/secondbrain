import "server-only";
import { prisma } from "@/lib/prisma";
import { mapAccessWhere } from "@/lib/map-access";
import { projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { extractRefs, linkContext, linkHref, parseLinkRef, type LinkKind } from "@/lib/shared/links";

/**
 * Liens entre objets (`[[…]]`) : suggestions pour l'éditeur, rétroliens
 * (« Mentionné dans ») et graphe de connaissances. Les liens vivent **dans le
 * HTML des notes** (attribut `data-ref`, conservé par `sanitizeNotes`) : pas
 * de table à tenir à jour, ils suivent toutes les écritures (site,
 * application hors ligne, connecteur MCP, modèles). Sources lues : notes des
 * projets, étapes, activités, tâches et nœuds de carte, comptes-rendus de
 * réunion. Tout est filtré par les droits de l'utilisateur (modèles exclus).
 */

export type LinkTarget = { ref: string; kind: LinkKind; title: string; context: string; href: string };
export type Backlink = LinkTarget & { excerpt: string };
export type GraphNode = { ref: string; kind: LinkKind; title: string; href: string; projectId: string | null; mapId: string | null };
export type KnowledgeGraph = { nodes: GraphNode[]; edges: { from: string; to: string }[]; truncated: boolean };

const PER_KIND = 4;
const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

/** Objets liables dont le titre contient `q` (4 par type au plus). */
export async function suggestLinks(userId: string, q: string): Promise<LinkTarget[]> {
  const query = q.trim().slice(0, 100);
  const take = PER_KIND;
  const order = { updatedAt: "desc" as const };
  const proj = projectAccessWhere(userId);
  const [projects, tasks, stages, activities, maps, nodes, meetings, documents] = await Promise.all([
    prisma.project.findMany({ where: { ...proj, name: ci(query) }, orderBy: order, take, select: { id: true, name: true, status: true } }),
    prisma.task.findMany({ where: { ...taskAccessWhere(userId), name: ci(query) }, orderBy: order, take, select: { id: true, name: true, project: { select: { name: true } } } }),
    prisma.stage.findMany({ where: { project: proj, name: ci(query) }, orderBy: order, take, select: { id: true, name: true, project: { select: { name: true } } } }),
    prisma.activity.findMany({ where: { stage: { project: proj }, name: ci(query) }, orderBy: order, take, select: { id: true, name: true, stage: { select: { name: true, project: { select: { name: true } } } } } }),
    prisma.mindMap.findMany({ where: { ...mapAccessWhere(userId), title: ci(query) }, orderBy: order, take, select: { id: true, title: true } }),
    prisma.mindNode.findMany({ where: { map: mapAccessWhere(userId), parentId: { not: null }, title: ci(query) }, orderBy: order, take, select: { id: true, title: true, mapId: true, map: { select: { title: true } } } }),
    prisma.meeting.findMany({ where: { project: proj, title: ci(query) }, orderBy: { date: "desc" }, take, select: { id: true, title: true, date: true, projectId: true, project: { select: { name: true } } } }),
    prisma.document.findMany({ where: { project: proj, name: ci(query) }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, projectId: true, project: { select: { name: true } } } }),
  ]);
  return [
    ...tasks.map((t) => ({ ref: `task:${t.id}`, kind: "task" as const, title: t.name, context: t.project?.name ?? "Sans projet", href: linkHref({ kind: "task", id: t.id }) })),
    ...projects.map((p) => ({ ref: `project:${p.id}`, kind: "project" as const, title: p.name, context: "Projet", href: linkHref({ kind: "project", id: p.id }) })),
    ...nodes.map((n) => ({ ref: `node:${n.id}`, kind: "node" as const, title: n.title, context: n.map.title, href: linkHref({ kind: "node", id: n.id, mapId: n.mapId }) })),
    ...maps.map((m) => ({ ref: `mindmap:${m.id}`, kind: "mindmap" as const, title: m.title, context: "Carte mentale", href: linkHref({ kind: "mindmap", id: m.id }) })),
    ...meetings.map((m) => ({ ref: `meeting:${m.id}`, kind: "meeting" as const, title: m.title, context: `${m.project.name} · ${m.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`, href: linkHref({ kind: "meeting", id: m.id, projectId: m.projectId }) })),
    ...stages.map((s) => ({ ref: `stage:${s.id}`, kind: "stage" as const, title: s.name, context: s.project.name, href: linkHref({ kind: "stage", id: s.id }) })),
    ...activities.map((a) => ({ ref: `activity:${a.id}`, kind: "activity" as const, title: a.name, context: `${a.stage.project.name} › ${a.stage.name}`, href: linkHref({ kind: "activity", id: a.id }) })),
    ...documents.map((d) => ({ ref: `document:${d.id}`, kind: "document" as const, title: d.name, context: d.project.name, href: linkHref({ kind: "document", id: d.id, projectId: d.projectId }) })),
  ];
}

type Source = { ref: string; kind: LinkKind; title: string; context: string; href: string; html: string; projectId: string | null; mapId: string | null };

/** Sources accessibles dont le HTML contient `needle` (au plus `take` par type). */
async function sources(userId: string, needle: string, take: number): Promise<{ list: Source[]; truncated: boolean }> {
  const proj = projectAccessWhere(userId);
  const has = { contains: needle };
  const [projects, stages, activities, tasks, nodes, meetings] = await Promise.all([
    prisma.project.findMany({ where: { ...proj, notes: has }, take, select: { id: true, name: true, notes: true } }),
    prisma.stage.findMany({ where: { project: proj, notes: has }, take, select: { id: true, name: true, notes: true, projectId: true, project: { select: { name: true } } } }),
    prisma.activity.findMany({ where: { stage: { project: proj }, notes: has }, take, select: { id: true, name: true, notes: true, stage: { select: { name: true, projectId: true, project: { select: { name: true } } } } } }),
    prisma.task.findMany({ where: { ...taskAccessWhere(userId), notes: has }, take, select: { id: true, name: true, notes: true, projectId: true, project: { select: { name: true } } } }),
    prisma.mindNode.findMany({ where: { map: mapAccessWhere(userId), notes: has }, take, select: { id: true, title: true, notes: true, parentId: true, mapId: true, map: { select: { title: true } } } }),
    prisma.meeting.findMany({ where: { project: proj, minutes: has }, take, select: { id: true, title: true, minutes: true, projectId: true, project: { select: { name: true } } } }),
  ]);
  const list: Source[] = [
    ...projects.map((p) => ({ ref: `project:${p.id}`, kind: "project" as const, title: p.name, context: "Projet", href: linkHref({ kind: "project", id: p.id }), html: p.notes, projectId: p.id, mapId: null })),
    ...stages.map((s) => ({ ref: `stage:${s.id}`, kind: "stage" as const, title: s.name, context: s.project.name, href: linkHref({ kind: "stage", id: s.id }), html: s.notes, projectId: s.projectId, mapId: null })),
    ...activities.map((a) => ({ ref: `activity:${a.id}`, kind: "activity" as const, title: a.name, context: `${a.stage.project.name} › ${a.stage.name}`, href: linkHref({ kind: "activity", id: a.id }), html: a.notes, projectId: a.stage.projectId, mapId: null })),
    ...tasks.map((t) => ({ ref: `task:${t.id}`, kind: "task" as const, title: t.name, context: t.project?.name ?? "Sans projet", href: linkHref({ kind: "task", id: t.id }), html: t.notes, projectId: t.projectId, mapId: null })),
    ...nodes.map((n) =>
      n.parentId === null
        ? { ref: `mindmap:${n.mapId}`, kind: "mindmap" as const, title: n.map.title, context: "Carte mentale", href: linkHref({ kind: "mindmap", id: n.mapId }), html: n.notes, projectId: null, mapId: n.mapId }
        : { ref: `node:${n.id}`, kind: "node" as const, title: n.title, context: n.map.title, href: linkHref({ kind: "node", id: n.id, mapId: n.mapId }), html: n.notes, projectId: null, mapId: n.mapId },
    ),
    ...meetings.map((m) => ({ ref: `meeting:${m.id}`, kind: "meeting" as const, title: m.title, context: m.project.name, href: linkHref({ kind: "meeting", id: m.id, projectId: m.projectId }), html: m.minutes, projectId: m.projectId, mapId: null })),
  ];
  const truncated = [projects, stages, activities, tasks, nodes, meetings].some((r) => r.length >= take);
  return { list, truncated };
}

/** « Mentionné dans » : objets accessibles dont les notes contiennent un lien vers `ref`. */
export async function getBacklinks(userId: string, ref: string): Promise<Backlink[]> {
  if (!parseLinkRef(ref)) return [];
  const { list } = await sources(userId, `data-ref="${ref}"`, 50);
  // Une carte mentale : ses notes sont celles de sa racine ; on évite de se citer soi-même.
  return list.filter((s) => s.ref !== ref).map(({ ref: r, kind, title, context, href, html }) => ({ ref: r, kind, title, context, href, excerpt: linkContext(html, ref) }));
}

/** Résout titres, liens et droits d'une liste de références cibles (les inaccessibles disparaissent). */
async function resolveTargets(userId: string, refs: string[]): Promise<Map<string, GraphNode>> {
  const ids: Record<LinkKind, string[]> = { project: [], stage: [], activity: [], task: [], mindmap: [], node: [], meeting: [], document: [] };
  for (const r of refs) {
    const p = parseLinkRef(r);
    if (p) ids[p.kind].push(p.id);
  }
  const proj = projectAccessWhere(userId);
  const none = <T,>() => Promise.resolve([] as T[]);
  const [projects, stages, activities, tasks, maps, nodes, meetings, documents] = await Promise.all([
    ids.project.length ? prisma.project.findMany({ where: { ...proj, id: { in: ids.project } }, select: { id: true, name: true } }) : none<{ id: string; name: string }>(),
    ids.stage.length ? prisma.stage.findMany({ where: { project: proj, id: { in: ids.stage } }, select: { id: true, name: true, projectId: true } }) : none<{ id: string; name: string; projectId: string }>(),
    ids.activity.length
      ? prisma.activity.findMany({ where: { stage: { project: proj }, id: { in: ids.activity } }, select: { id: true, name: true, stage: { select: { projectId: true } } } })
      : none<{ id: string; name: string; stage: { projectId: string } }>(),
    ids.task.length ? prisma.task.findMany({ where: { ...taskAccessWhere(userId), id: { in: ids.task } }, select: { id: true, name: true, projectId: true } }) : none<{ id: string; name: string; projectId: string | null }>(),
    ids.mindmap.length ? prisma.mindMap.findMany({ where: { ...mapAccessWhere(userId), id: { in: ids.mindmap } }, select: { id: true, title: true } }) : none<{ id: string; title: string }>(),
    ids.node.length ? prisma.mindNode.findMany({ where: { map: mapAccessWhere(userId), id: { in: ids.node } }, select: { id: true, title: true, mapId: true } }) : none<{ id: string; title: string; mapId: string }>(),
    ids.meeting.length ? prisma.meeting.findMany({ where: { project: proj, id: { in: ids.meeting } }, select: { id: true, title: true, projectId: true } }) : none<{ id: string; title: string; projectId: string }>(),
    ids.document.length ? prisma.document.findMany({ where: { project: proj, id: { in: ids.document } }, select: { id: true, name: true, projectId: true } }) : none<{ id: string; name: string; projectId: string }>(),
  ]);
  const m = new Map<string, GraphNode>();
  const put = (n: GraphNode) => m.set(n.ref, n);
  for (const x of projects) put({ ref: `project:${x.id}`, kind: "project", title: x.name, href: linkHref({ kind: "project", id: x.id }), projectId: x.id, mapId: null });
  for (const x of stages) put({ ref: `stage:${x.id}`, kind: "stage", title: x.name, href: linkHref({ kind: "stage", id: x.id }), projectId: x.projectId, mapId: null });
  for (const x of activities) put({ ref: `activity:${x.id}`, kind: "activity", title: x.name, href: linkHref({ kind: "activity", id: x.id }), projectId: x.stage.projectId, mapId: null });
  for (const x of tasks) put({ ref: `task:${x.id}`, kind: "task", title: x.name, href: linkHref({ kind: "task", id: x.id }), projectId: x.projectId, mapId: null });
  for (const x of maps) put({ ref: `mindmap:${x.id}`, kind: "mindmap", title: x.title, href: linkHref({ kind: "mindmap", id: x.id }), projectId: null, mapId: x.id });
  for (const x of nodes) put({ ref: `node:${x.id}`, kind: "node", title: x.title, href: linkHref({ kind: "node", id: x.id, mapId: x.mapId }), projectId: null, mapId: x.mapId });
  for (const x of meetings) put({ ref: `meeting:${x.id}`, kind: "meeting", title: x.title, href: linkHref({ kind: "meeting", id: x.id, projectId: x.projectId }), projectId: x.projectId, mapId: null });
  for (const x of documents) put({ ref: `document:${x.id}`, kind: "document", title: x.name, href: linkHref({ kind: "document", id: x.id, projectId: x.projectId }), projectId: x.projectId, mapId: null });
  return m;
}

/** Graphe de connaissances : objets reliés par des liens `[[…]]` (dans le périmètre de l'utilisateur). */
export async function getKnowledgeGraph(userId: string): Promise<KnowledgeGraph> {
  const { list, truncated } = await sources(userId, 'data-ref="', 2000);
  const edges: { from: string; to: string }[] = [];
  const targets = new Set<string>();
  for (const s of list) {
    for (const r of extractRefs(s.html)) {
      if (r === s.ref) continue;
      edges.push({ from: s.ref, to: r });
      targets.add(r);
    }
  }
  const resolved = await resolveTargets(userId, [...targets]);
  const nodes = new Map<string, GraphNode>();
  for (const s of list) nodes.set(s.ref, { ref: s.ref, kind: s.kind, title: s.title, href: s.href, projectId: s.projectId, mapId: s.mapId });
  for (const [k, v] of resolved) if (!nodes.has(k)) nodes.set(k, v);
  const kept = edges.filter((e) => nodes.has(e.to) && resolved.has(e.to));
  const linked = new Set(kept.flatMap((e) => [e.from, e.to]));
  return { nodes: [...nodes.values()].filter((n) => linked.has(n.ref)), edges: kept, truncated };
}
