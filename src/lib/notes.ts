import "server-only";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { sanitizeNotes } from "@/lib/sanitize";
import { hasHtmlContent, projectAccessWhere, projectEditWhere, taskAccessWhere, taskEditWhere, taskHref } from "@/lib/projects";
import { NO_PROJECT_LABEL } from "@/lib/tasks";
import { mapAccessWhere, requireMapAccess } from "@/lib/map-access";
import { mapAccessOf } from "@/lib/shared/map-access";
import { updateNode } from "@/lib/mindmaps";

/**
 * « Prise de notes » : arborescence façon Notion de tous les objets de
 * l'application, chargée de proche en proche (`children(parent)`), et un
 * document de notes riches par objet (`getDocument` / `saveNotes`).
 *
 *   root ─ section:mindmaps ─ mindmap:<id> ─ node:<id> ─ node:<id> …
 *        └ section:projects ─ project:<id> ─ stage:<id> ─ activity:<id> ─ task:<id>
 *                           │                           └ task:<id> (sans activité)
 *                           │             └ task:<id> (sans étape)
 *                           └ section:orphans ─ task:<id> (sans projet)
 *
 * Les notes d'une carte mentale sont celles de son nœud racine ; celles d'un
 * nœud sont la zone « Notes » déjà présente dans l'éditeur de carte. Les
 * cartes partagées avec moi y figurent aussi ; en lecture seule, leurs
 * documents ont `editable: false` et l'enregistrement est refusé (403).
 * Références : `kind:id` ; sections : `section:<name>` ; racine : `root`.
 */

export type NoteKind = "root" | "section" | "mindmap" | "node" | "project" | "stage" | "activity" | "task";

export type TreeItem = {
  ref: string;
  kind: NoteKind;
  id: string;
  title: string;
  /** Sous-titre léger (statut, compteur…). */
  hint?: string;
  color?: string | null;
  hasChildren: boolean;
  hasNotes: boolean;
};

export type NoteDocument = {
  ref: string;
  kind: NoteKind;
  id: string;
  title: string;
  /** Chemin depuis la racine (sans l'objet lui-même). */
  breadcrumb: Array<{ ref: string; title: string }>;
  /** Page dédiée de l'objet. */
  href: string | null;
  /** HTML assaini ; non éditable pour les sections (`editable: false`). */
  notes: string;
  editable: boolean;
  updatedAt: string | null;
};

const SECTIONS = {
  mindmaps: "Cartes mentales",
  projects: "Projets",
  orphans: NO_PROJECT_LABEL,
} as const;
type SectionName = keyof typeof SECTIONS;

export function parseRef(ref: string): { kind: NoteKind; id: string } {
  if (ref === "root") return { kind: "root", id: "" };
  const i = ref.indexOf(":");
  if (i <= 0) throw badRequest("Référence invalide.");
  const kind = ref.slice(0, i) as NoteKind;
  const id = ref.slice(i + 1);
  if (!["section", "mindmap", "node", "project", "stage", "activity", "task"].includes(kind) || !id) throw badRequest("Référence invalide.");
  if (kind === "section" && !(id in SECTIONS)) throw badRequest("Section inconnue.");
  return { kind, id };
}

const taskItem = (t: { id: string; name: string; status: string; notes: string }): TreeItem => ({
  ref: `task:${t.id}`,
  kind: "task",
  id: t.id,
  title: t.name,
  hint: t.status === "DONE" ? "terminée" : t.status === "CLOSED" ? "clôturée" : t.status === "IN_PROGRESS" ? "en cours" : undefined,
  hasChildren: false,
  hasNotes: hasHtmlContent(t.notes),
});

/** Enfants directs d'une référence (chargement paresseux de l'arborescence). */
export async function children(userId: string, parentRef: string): Promise<TreeItem[]> {
  const { kind, id } = parseRef(parentRef);
  switch (kind) {
    case "root":
      return [
        { ref: "section:mindmaps", kind: "section", id: "mindmaps", title: SECTIONS.mindmaps, hasChildren: true, hasNotes: false },
        { ref: "section:projects", kind: "section", id: "projects", title: SECTIONS.projects, hasChildren: true, hasNotes: false },
      ];
    case "section": {
      const name = id as SectionName;
      if (name === "mindmaps") {
        const maps = await prisma.mindMap.findMany({
          where: mapAccessWhere(userId),
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, ownerId: true, owner: { select: { name: true } }, _count: { select: { nodes: true } }, nodes: { where: { parentId: null }, select: { notes: true } } },
        });
        return maps.map((m) => ({
          ref: `mindmap:${m.id}`,
          kind: "mindmap",
          id: m.id,
          title: m.title,
          hint: `${m._count.nodes} nœud${m._count.nodes > 1 ? "s" : ""}${m.ownerId !== userId ? ` · partagée par ${m.owner.name}` : ""}`,
          hasChildren: m._count.nodes > 1,
          hasNotes: hasHtmlContent(m.nodes[0]?.notes ?? ""),
        }));
      }
      if (name === "projects") {
        const [projects, orphanCount] = await Promise.all([
          prisma.project.findMany({
            where: projectAccessWhere(userId),
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true, color: true, status: true, notes: true, _count: { select: { stages: true, tasks: true } } },
          }),
          prisma.task.count({ where: { ownerId: userId, projectId: null } }),
        ]);
        const items: TreeItem[] = projects.map((p) => ({
          ref: `project:${p.id}`,
          kind: "project",
          id: p.id,
          title: p.name,
          hint: p.status === "ARCHIVED" ? "archivé" : p.status === "DONE" ? "terminé" : p.status === "ON_HOLD" ? "en pause" : undefined,
          color: p.color,
          hasChildren: p._count.stages + p._count.tasks > 0,
          hasNotes: hasHtmlContent(p.notes),
        }));
        items.push({ ref: "section:orphans", kind: "section", id: "orphans", title: SECTIONS.orphans, hint: `${orphanCount} tâche${orphanCount > 1 ? "s" : ""}`, hasChildren: orphanCount > 0, hasNotes: false });
        return items;
      }
      const orphans = await prisma.task.findMany({ where: { ownerId: userId, projectId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, status: true, notes: true } });
      return orphans.map(taskItem);
    }
    case "mindmap": {
      await requireMapAccess(userId, id, "read");
      const root = await prisma.mindNode.findFirst({ where: { mapId: id, parentId: null }, select: { id: true } });
      return root ? nodeChildren(userId, root.id) : [];
    }
    case "node":
      return nodeChildren(userId, id);
    case "project": {
      const p = await prisma.project.findFirst({
        where: { id, ...projectAccessWhere(userId) },
        select: {
          stages: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, notes: true, _count: { select: { activities: true, tasks: true } } } },
          tasks: { where: { stageId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, status: true, notes: true } },
        },
      });
      if (!p) throw notFound("Projet");
      return [
        ...p.stages.map<TreeItem>((s) => ({ ref: `stage:${s.id}`, kind: "stage", id: s.id, title: s.name, hasChildren: s._count.activities + s._count.tasks > 0, hasNotes: hasHtmlContent(s.notes) })),
        ...p.tasks.map(taskItem),
      ];
    }
    case "stage": {
      const s = await prisma.stage.findFirst({
        where: { id, project: projectAccessWhere(userId) },
        select: {
          activities: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, notes: true, _count: { select: { tasks: true } } } },
          tasks: { where: { activityId: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, status: true, notes: true } },
        },
      });
      if (!s) throw notFound("Étape");
      return [
        ...s.activities.map<TreeItem>((a) => ({ ref: `activity:${a.id}`, kind: "activity", id: a.id, title: a.name, hasChildren: a._count.tasks > 0, hasNotes: hasHtmlContent(a.notes) })),
        ...s.tasks.map(taskItem),
      ];
    }
    case "activity": {
      const a = await prisma.activity.findFirst({
        where: { id, stage: { project: projectAccessWhere(userId) } },
        select: { tasks: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, status: true, notes: true } } },
      });
      if (!a) throw notFound("Activité");
      return a.tasks.map(taskItem);
    }
    case "task":
      return [];
  }
}

async function nodeChildren(userId: string, nodeId: string): Promise<TreeItem[]> {
  const parent = await prisma.mindNode.findFirst({ where: { id: nodeId, map: mapAccessWhere(userId) }, select: { id: true } });
  if (!parent) throw notFound("Nœud");
  const nodes = await prisma.mindNode.findMany({
    where: { parentId: nodeId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, notes: true, status: true, _count: { select: { children: true } } },
  });
  return nodes.map((n) => ({
    ref: `node:${n.id}`,
    kind: "node",
    id: n.id,
    title: n.title,
    hint: n.status === "CLOSED" ? "fermé" : n.status === "WATCH" ? "à surveiller" : undefined,
    hasChildren: n._count.children > 0,
    hasNotes: hasHtmlContent(n.notes),
  }));
}

/** Nœud de carte avec sa carte et sa chaîne d'ancêtres (fil d'Ariane). */
async function nodeWithPath(userId: string, nodeId: string) {
  const n = await prisma.mindNode.findFirst({
    where: { id: nodeId, map: mapAccessWhere(userId) },
    include: { map: { select: { id: true, title: true, ownerId: true, shares: { where: { userId }, select: { permission: true } } } } },
  });
  if (!n) throw notFound("Nœud");
  const all = await prisma.mindNode.findMany({ where: { mapId: n.mapId }, select: { id: true, parentId: true, title: true } });
  const byId = new Map(all.map((x) => [x.id, x]));
  const path: Array<{ ref: string; title: string }> = [];
  for (let cur = n.parentId; cur; cur = byId.get(cur)?.parentId ?? null) {
    const p = byId.get(cur);
    if (!p) break;
    path.unshift(p.parentId === null ? { ref: `mindmap:${n.mapId}`, title: n.map.title } : { ref: `node:${p.id}`, title: p.title });
  }
  return { node: n, path };
}

const SECTION_CRUMB = { mindmaps: { ref: "section:mindmaps", title: SECTIONS.mindmaps }, projects: { ref: "section:projects", title: SECTIONS.projects }, orphans: { ref: "section:orphans", title: SECTIONS.orphans } };

/** Document de notes d'un objet, avec fil d'Ariane et lien vers sa page. */
export async function getDocument(userId: string, ref: string): Promise<NoteDocument> {
  const { kind, id } = parseRef(ref);
  const base = { ref, kind, id, editable: true };
  switch (kind) {
    case "root":
      return { ...base, title: "Prise de notes", breadcrumb: [], href: null, notes: "", editable: false, updatedAt: null };
    case "section":
      return { ...base, title: SECTIONS[id as SectionName], breadcrumb: id === "orphans" ? [SECTION_CRUMB.projects] : [], href: id === "mindmaps" ? "/mindmaps" : id === "projects" ? "/projects" : "/projects/sans-projet", notes: "", editable: false, updatedAt: null };
    case "mindmap": {
      const { access } = await requireMapAccess(userId, id, "read");
      const map = await prisma.mindMap.findUniqueOrThrow({ where: { id }, include: { nodes: { where: { parentId: null }, select: { notes: true, updatedAt: true } } } });
      return { ...base, editable: access !== "read", title: map.title, breadcrumb: [SECTION_CRUMB.mindmaps], href: `/mindmaps/${map.id}`, notes: sanitizeNotes(map.nodes[0]?.notes ?? ""), updatedAt: (map.nodes[0]?.updatedAt ?? map.updatedAt).toISOString() };
    }
    case "node": {
      const { node, path } = await nodeWithPath(userId, id);
      if (node.parentId === null) return getDocument(userId, `mindmap:${node.mapId}`);
      const editable = mapAccessOf(node.map.ownerId, userId, node.map.shares[0]?.permission) !== "read";
      return { ...base, editable, title: node.title, breadcrumb: [SECTION_CRUMB.mindmaps, ...path], href: `/mindmaps/${node.mapId}?node=${node.id}`, notes: sanitizeNotes(node.notes), updatedAt: node.updatedAt.toISOString() };
    }
    case "project": {
      const p = await prisma.project.findFirst({ where: { id, ...(await projectEditWhere(userId)) }, select: { id: true, name: true, notes: true, updatedAt: true } });
      if (!p) throw notFound("Projet");
      return { ...base, title: p.name, breadcrumb: [SECTION_CRUMB.projects], href: `/projects/${p.id}`, notes: sanitizeNotes(p.notes), updatedAt: p.updatedAt.toISOString() };
    }
    case "stage": {
      const s = await prisma.stage.findFirst({ where: { id, project: (await projectEditWhere(userId)) }, select: { id: true, name: true, notes: true, updatedAt: true, project: { select: { id: true, name: true } } } });
      if (!s) throw notFound("Étape");
      return { ...base, title: s.name, breadcrumb: [SECTION_CRUMB.projects, { ref: `project:${s.project.id}`, title: s.project.name }], href: `/projects/${s.project.id}#plan`, notes: sanitizeNotes(s.notes), updatedAt: s.updatedAt.toISOString() };
    }
    case "activity": {
      const a = await prisma.activity.findFirst({
        where: { id, stage: { project: (await projectEditWhere(userId)) } },
        select: { id: true, name: true, notes: true, updatedAt: true, stage: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      });
      if (!a) throw notFound("Activité");
      return {
        ...base,
        title: a.name,
        breadcrumb: [SECTION_CRUMB.projects, { ref: `project:${a.stage.project.id}`, title: a.stage.project.name }, { ref: `stage:${a.stage.id}`, title: a.stage.name }],
        href: `/projects/${a.stage.project.id}#plan`,
        notes: sanitizeNotes(a.notes),
        updatedAt: a.updatedAt.toISOString(),
      };
    }
    case "task": {
      const t = await prisma.task.findFirst({
        where: { id, ...(await taskEditWhere(userId)) },
        select: { id: true, name: true, notes: true, updatedAt: true, project: { select: { id: true, name: true } }, stage: { select: { id: true, name: true } }, activity: { select: { id: true, name: true } } },
      });
      if (!t) throw notFound("Tâche");
      const breadcrumb: Array<{ ref: string; title: string }> = [SECTION_CRUMB.projects];
      if (t.project) breadcrumb.push({ ref: `project:${t.project.id}`, title: t.project.name });
      else breadcrumb.push(SECTION_CRUMB.orphans);
      if (t.stage) breadcrumb.push({ ref: `stage:${t.stage.id}`, title: t.stage.name });
      if (t.activity) breadcrumb.push({ ref: `activity:${t.activity.id}`, title: t.activity.name });
      return { ...base, title: t.name, breadcrumb, href: taskHref(t.id), notes: sanitizeNotes(t.notes), updatedAt: t.updatedAt.toISOString() };
    }
  }
}

/** Enregistre les notes d'un objet (HTML assaini). Les cartes écrivent sur leur nœud racine. */
export async function saveNotes(userId: string, ref: string, html: string): Promise<NoteDocument> {
  const { kind, id } = parseRef(ref);
  const notes = sanitizeNotes(html);
  switch (kind) {
    case "root":
    case "section":
      throw badRequest("Cet élément ne porte pas de notes.");
    // Cartes : via updateNode (droit d'écriture + verrou de la carte).
    case "mindmap": {
      await requireMapAccess(userId, id, "write");
      const root = await prisma.mindNode.findFirst({ where: { mapId: id, parentId: null }, select: { id: true } });
      if (!root) throw notFound("Carte");
      await updateNode(userId, id, root.id, { notes });
      break;
    }
    case "node": {
      const n = await prisma.mindNode.findFirst({ where: { id, map: mapAccessWhere(userId) }, select: { id: true, mapId: true } });
      if (!n) throw notFound("Nœud");
      await updateNode(userId, n.mapId, id, { notes });
      break;
    }
    case "project": {
      const p = await prisma.project.findFirst({ where: { id, ...(await projectEditWhere(userId)) }, select: { id: true } });
      if (!p) throw notFound("Projet");
      await prisma.project.update({ where: { id }, data: { notes } });
      break;
    }
    case "stage": {
      const s = await prisma.stage.findFirst({ where: { id, project: (await projectEditWhere(userId)) }, select: { id: true } });
      if (!s) throw notFound("Étape");
      await prisma.stage.update({ where: { id }, data: { notes } });
      break;
    }
    case "activity": {
      const a = await prisma.activity.findFirst({ where: { id, stage: { project: (await projectEditWhere(userId)) } }, select: { id: true } });
      if (!a) throw notFound("Activité");
      await prisma.activity.update({ where: { id }, data: { notes } });
      break;
    }
    case "task": {
      const t = await prisma.task.findFirst({ where: { id, ...(await taskEditWhere(userId)) }, select: { id: true } });
      if (!t) throw notFound("Tâche");
      await prisma.task.update({ where: { id }, data: { notes } });
      break;
    }
  }
  return getDocument(userId, ref);
}
