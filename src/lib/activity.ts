import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/roles";
import { projectAccessWhere } from "@/lib/projects";
import { mapAccessWhere } from "@/lib/map-access";
import { NO_PROJECT_LABEL } from "@/lib/tasks";
import { levelLabel, riskLevel, riskScore, RISK_STATUS_LABEL } from "@/lib/shared/risks";
import { addDays, parisYmd, resolveActivityWindow, type ActivityWindow } from "@/lib/shared/activity-period";

/**
 * Rapport d'activité sur une fenêtre de temps libre (jour, semaine, mois,
 * dates quelconques) : consolide tout ce qui a évolué dans le périmètre de
 * l'utilisateur — tâches (piste d'audit), cartes mentales (piste d'audit),
 * réunions (créées, compte-rendu modifié, décisions), risques et
 * opportunités, livrables, documents, projets et étapes créés.
 *
 * Servi par GET /api/v1/activity (page « Activité », application) et par
 * l'outil MCP `get_activity`. Un administrateur peut demander explicitement
 * toute la plateforme (`all`), en lecture.
 *
 * Limites : une tâche supprimée emporte son historique (piste d'audit en
 * cascade) ; les risques, livrables et réunions n'ont pas d'historique
 * détaillé (création / dernière modification seulement).
 */

export type ActivityEvent = { at: string; actor: string; kind: string; message: string };

export type ActivityCounts = {
  tasksCreated: number;
  tasksCompleted: number;
  tasksClosed: number;
  tasksReopened: number;
  tasksRescheduled: number;
  assignments: number;
  comments: number;
  taskChanges: number;
  nodesCreated: number;
  nodesChanged: number;
  nodesDeleted: number;
  notesEdited: number;
  meetings: number;
  decisions: number;
  risks: number;
  deliverables: number;
  documents: number;
};

export type ActivityTask = { id: string; name: string; status: string; deleted: boolean; stageName: string | null; events: ActivityEvent[]; eventCount: number };
export type ActivityProject = {
  id: string | null;
  name: string;
  color: string | null;
  createdInPeriod: boolean;
  total: number;
  counts: ActivityCounts;
  tasks: ActivityTask[];
  stagesCreated: string[];
  meetings: { id: string; title: string; date: string; events: ActivityEvent[] }[];
  risks: { id: string; kind: string; title: string; status: string; level: string; created: boolean; updatedAt: string }[];
  deliverables: { id: string; name: string; status: string; created: boolean; updatedAt: string }[];
  documents: { id: string; name: string; at: string; actor: string | null }[];
};
export type ActivityMap = {
  id: string;
  title: string;
  total: number;
  counts: Pick<ActivityCounts, "nodesCreated" | "nodesChanged" | "nodesDeleted" | "notesEdited">;
  /** Événements de la carte elle-même (création, renommage, partages…). */
  events: ActivityEvent[];
  nodes: { id: string; title: string; deleted: boolean; events: ActivityEvent[]; eventCount: number }[];
};
export type ActivityReport = {
  from: string;
  to: string;
  label: string;
  scope: "mine" | "all";
  totals: ActivityCounts & { events: number };
  people: { name: string; count: number }[];
  /** Nombre d'événements par jour (AAAA-MM-JJ, heure de Paris). */
  days: { day: string; tasks: number; maps: number; other: number }[];
  projects: ActivityProject[];
  maps: ActivityMap[];
  /** Vrai si des listes ont été tronquées (gros volumes). */
  truncated: boolean;
};

export type ActivityQuery = { period?: string | null; from?: string | null; to?: string | null; projectId?: string | null; mapId?: string | null; all?: boolean };

const MAX_TASK_EVENTS = 20_000;
const MAX_MAP_EVENTS = 10_000;
const EVENTS_PER_ITEM = 30;

const emptyCounts = (): ActivityCounts => ({
  tasksCreated: 0,
  tasksCompleted: 0,
  tasksClosed: 0,
  tasksReopened: 0,
  tasksRescheduled: 0,
  assignments: 0,
  comments: 0,
  taskChanges: 0,
  nodesCreated: 0,
  nodesChanged: 0,
  nodesDeleted: 0,
  notesEdited: 0,
  meetings: 0,
  decisions: 0,
  risks: 0,
  deliverables: 0,
  documents: 0,
});

/** Range un événement de tâche dans les compteurs. */
function countTaskEvent(c: ActivityCounts, e: { kind: string; field: string | null; oldValue: string | null; newValue: string | null }) {
  if (e.kind === "created") c.tasksCreated++;
  else if (e.kind === "comment") c.comments++;
  else if (e.kind === "assignee" || e.kind === "supervisor" || e.kind === "contributors") c.assignments++;
  else if (e.kind === "field" && e.field === "status") {
    if (e.newValue === "Terminée") c.tasksCompleted++;
    else if (e.newValue === "Clôturée") c.tasksClosed++;
    else if (e.oldValue === "Terminée" || e.oldValue === "Clôturée") c.tasksReopened++;
    else c.taskChanges++;
  } else if (e.kind === "field" && (e.field === "startDate" || e.field === "dueDate")) c.tasksRescheduled++;
  else c.taskChanges++;
}

function countMapEvent(c: Pick<ActivityCounts, "nodesCreated" | "nodesChanged" | "nodesDeleted" | "notesEdited">, kind: string) {
  if (kind === "node_created") c.nodesCreated++;
  else if (kind === "node_deleted") c.nodesDeleted++;
  else if (kind === "node_notes") c.notesEdited++;
  else if (kind.startsWith("node_") || kind.startsWith("task_")) c.nodesChanged++;
}

const sumCounts = (cs: ActivityCounts[]): ActivityCounts => {
  const out = emptyCounts();
  for (const c of cs) for (const k of Object.keys(out) as (keyof ActivityCounts)[]) out[k] += c[k];
  return out;
};

export async function getActivity(user: { id: string; email: string; role: string }, query: ActivityQuery): Promise<ActivityReport> {
  let window: ActivityWindow;
  try {
    window = resolveActivityWindow(query);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : String(e));
  }
  const all = !!query.all;
  if (all && !isAdmin(user as Parameters<typeof isAdmin>[0])) throw new ApiError(403, "FORBIDDEN", "Réservé aux administrateurs.");
  const userId = user.id;
  const range = { gte: window.start, lt: window.end };

  // --- Périmètre ---------------------------------------------------------------------------
  const wantProjects = !query.mapId;
  const wantMaps = !query.projectId;
  const projectWhere: Prisma.ProjectWhereInput = { ...(all ? {} : projectAccessWhere(userId)), ...(query.projectId ? { id: query.projectId } : {}) };
  const projects = wantProjects ? await prisma.project.findMany({ where: projectWhere, select: { id: true, name: true, color: true, createdAt: true } }) : [];
  if (query.projectId && projects.length === 0) throw notFound("Projet");
  const pids = projects.map((p) => p.id);
  const mapWhere: Prisma.MindMapWhereInput = { AND: [all ? {} : mapAccessWhere(userId), query.mapId ? { id: query.mapId } : {}] };
  const maps = wantMaps ? await prisma.mindMap.findMany({ where: mapWhere, select: { id: true, title: true } }) : [];
  if (query.mapId && maps.length === 0) throw notFound("Carte");
  const mids = maps.map((m) => m.id);
  // Tâches sans projet : les miennes (ou toutes pour l'administration), hors filtre projet / carte.
  const orphanWhere: Prisma.TaskWhereInput | null = wantProjects && !query.projectId ? (all ? { projectId: null } : { projectId: null, ownerId: userId }) : null;

  // --- Lectures (en parallèle) -------------------------------------------------------------
  const taskScope: Prisma.TaskWhereInput = { OR: [...(pids.length ? [{ projectId: { in: pids } }] : []), ...(orphanWhere ? [orphanWhere] : [])] };
  const hasTaskScope = (taskScope.OR as unknown[]).length > 0;
  const [taskEvents, mapEvents, meetings, risks, deliverables, documents, stages] = await Promise.all([
    hasTaskScope
      ? prisma.taskEvent.findMany({
          where: { createdAt: range, task: taskScope },
          orderBy: { createdAt: "asc" },
          take: MAX_TASK_EVENTS + 1,
          select: { taskId: true, kind: true, field: true, oldValue: true, newValue: true, message: true, actorName: true, createdAt: true, task: { select: { name: true, status: true, projectId: true, stage: { select: { name: true } } } } },
        })
      : [],
    mids.length
      ? prisma.mapEvent.findMany({ where: { mapId: { in: mids }, createdAt: range }, orderBy: { createdAt: "asc" }, take: MAX_MAP_EVENTS + 1 })
      : [],
    pids.length
      ? prisma.meeting.findMany({
          where: { projectId: { in: pids }, OR: [{ createdAt: range }, { minutesUpdatedAt: range }, { approvers: { some: { decidedAt: range } } }] },
          include: { author: { select: { name: true } }, approvers: { where: { decidedAt: range }, include: { member: { select: { name: true } } } } },
        })
      : [],
    pids.length ? prisma.risk.findMany({ where: { projectId: { in: pids }, OR: [{ createdAt: range }, { updatedAt: range }] } }) : [],
    pids.length ? prisma.deliverable.findMany({ where: { projectId: { in: pids }, OR: [{ createdAt: range }, { updatedAt: range }] } }) : [],
    pids.length ? prisma.document.findMany({ where: { projectId: { in: pids }, createdAt: range }, include: { uploadedBy: { select: { name: true } } } }) : [],
    pids.length ? prisma.stage.findMany({ where: { projectId: { in: pids }, createdAt: range }, select: { projectId: true, name: true } }) : [],
  ]);
  let truncated = taskEvents.length > MAX_TASK_EVENTS || mapEvents.length > MAX_MAP_EVENTS;
  const tEvents = taskEvents.slice(0, MAX_TASK_EVENTS);
  const mEvents = mapEvents.slice(0, MAX_MAP_EVENTS);

  // --- Projets -----------------------------------------------------------------------------
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const people = new Map<string, number>();
  const seen = (name: string | null | undefined) => name && people.set(name, (people.get(name) ?? 0) + 1);
  const dayCounts = new Map<string, { tasks: number; maps: number; other: number }>();
  const day = (d: Date, k: "tasks" | "maps" | "other") => {
    const key = parisYmd(d);
    const v = dayCounts.get(key) ?? { tasks: 0, maps: 0, other: 0 };
    v[k]++;
    dayCounts.set(key, v);
  };

  const pBuckets = new Map<string, ActivityProject>();
  const bucket = (pid: string | null): ActivityProject => {
    const key = pid ?? "__none__";
    let b = pBuckets.get(key);
    if (!b) {
      const p = pid ? projectById.get(pid) : null;
      b = {
        id: pid,
        name: p?.name ?? NO_PROJECT_LABEL,
        color: p?.color ?? null,
        createdInPeriod: !!p && p.createdAt >= window.start && p.createdAt < window.end,
        total: 0,
        counts: emptyCounts(),
        tasks: [],
        stagesCreated: [],
        meetings: [],
        risks: [],
        deliverables: [],
        documents: [],
      };
      pBuckets.set(key, b);
    }
    return b;
  };
  for (const p of projects) {
    if (p.createdAt < window.start || p.createdAt >= window.end) continue;
    // La création du projet compte comme une évolution.
    bucket(p.id).total++;
    day(p.createdAt, "other");
  }

  const taskById = new Map<string, ActivityTask & { projectId: string | null }>();
  for (const e of tEvents) {
    const b = bucket(e.task.projectId);
    countTaskEvent(b.counts, e);
    b.total++;
    seen(e.actorName);
    day(e.createdAt, "tasks");
    let t = taskById.get(e.taskId);
    if (!t) {
      t = { id: e.taskId, name: e.task.name, status: e.task.status, deleted: false, stageName: e.task.stage?.name ?? null, events: [], eventCount: 0, projectId: e.task.projectId };
      taskById.set(e.taskId, t);
      b.tasks.push(t);
    }
    t.eventCount++;
    t.events.push({ at: e.createdAt.toISOString(), actor: e.actorName, kind: e.kind === "field" ? `field:${e.field}` : e.kind, message: e.message });
  }
  for (const s of stages) bucket(s.projectId).stagesCreated.push(s.name);
  for (const m of meetings) {
    const b = bucket(m.projectId);
    const events: ActivityEvent[] = [];
    if (m.createdAt >= window.start && m.createdAt < window.end) events.push({ at: m.createdAt.toISOString(), actor: m.author?.name ?? "—", kind: "meeting_created", message: `Réunion « ${m.title} » créée` });
    if (m.minutesUpdatedAt && m.minutesUpdatedAt >= window.start && m.minutesUpdatedAt < window.end && m.minutesUpdatedAt.getTime() - m.createdAt.getTime() > 60_000) {
      events.push({ at: m.minutesUpdatedAt.toISOString(), actor: m.author?.name ?? "—", kind: "minutes", message: "Compte-rendu modifié" });
    }
    for (const a of m.approvers) {
      b.counts.decisions++;
      const verb = a.decision === "APPROVED" ? "a validé" : a.decision === "REJECTED" ? "a refusé" : "a répondu à";
      events.push({ at: a.decidedAt!.toISOString(), actor: a.member.name, kind: "decision", message: `${a.member.name} ${verb} le compte-rendu${a.comment ? ` : « ${a.comment.slice(0, 200)} »` : ""}` });
    }
    events.sort((x, y) => x.at.localeCompare(y.at));
    for (const e of events) {
      seen(e.actor === "—" ? null : e.actor);
      day(new Date(e.at), "other");
    }
    b.counts.meetings++;
    b.total += events.length;
    b.meetings.push({ id: m.id, title: m.title, date: m.date.toISOString(), events });
  }
  for (const r of risks) {
    const b = bucket(r.projectId);
    const created = r.createdAt >= window.start && r.createdAt < window.end;
    const level = riskLevel(riskScore(r.probability, r.impact));
    b.counts.risks++;
    b.total++;
    day(created ? r.createdAt : r.updatedAt, "other");
    b.risks.push({ id: r.id, kind: r.kind, title: r.title, status: RISK_STATUS_LABEL[r.status], level: levelLabel(r.kind, level), created, updatedAt: r.updatedAt.toISOString() });
  }
  for (const d of deliverables) {
    const b = bucket(d.projectId);
    const created = d.createdAt >= window.start && d.createdAt < window.end;
    b.counts.deliverables++;
    b.total++;
    day(created ? d.createdAt : d.updatedAt, "other");
    b.deliverables.push({ id: d.id, name: d.name, status: d.status, created, updatedAt: d.updatedAt.toISOString() });
  }
  for (const d of documents) {
    const b = bucket(d.projectId);
    b.counts.documents++;
    b.total++;
    seen(d.uploadedBy?.name);
    day(d.createdAt, "other");
    b.documents.push({ id: d.id, name: d.name, at: d.createdAt.toISOString(), actor: d.uploadedBy?.name ?? null });
  }

  // Tâches : les plus actives d'abord ; événements les plus récents conservés.
  const projectList = [...pBuckets.values()];
  for (const b of projectList) {
    b.tasks.sort((x, y) => y.eventCount - x.eventCount || x.name.localeCompare(y.name, "fr"));
    for (const t of b.tasks) {
      if (t.events.length > EVENTS_PER_ITEM) {
        t.events = t.events.slice(-EVENTS_PER_ITEM);
        truncated = true;
      }
      delete (t as Partial<typeof t> & { projectId?: unknown }).projectId;
    }
  }
  // Tâches supprimées depuis : on ne connaît que leur historique restant (rien) — repérer les absentes.
  const stillThere = new Set((await prisma.task.findMany({ where: { id: { in: [...taskById.keys()] } }, select: { id: true } })).map((t) => t.id));
  for (const t of taskById.values()) if (!stillThere.has(t.id)) t.deleted = true;
  projectList.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, "fr"));

  // --- Cartes ------------------------------------------------------------------------------
  const mapById = new Map(maps.map((m) => [m.id, m]));
  const mBuckets = new Map<string, ActivityMap>();
  const nodeBuckets = new Map<string, ActivityMap["nodes"][number]>();
  for (const e of mEvents) {
    let b = mBuckets.get(e.mapId);
    if (!b) {
      b = { id: e.mapId, title: mapById.get(e.mapId)?.title ?? "Carte", total: 0, counts: { nodesCreated: 0, nodesChanged: 0, nodesDeleted: 0, notesEdited: 0 }, events: [], nodes: [] };
      mBuckets.set(e.mapId, b);
    }
    b.total++;
    countMapEvent(b.counts, e.kind);
    seen(e.actorName);
    day(e.createdAt, "maps");
    const ev = { at: e.createdAt.toISOString(), actor: e.actorName, kind: e.kind, message: e.message };
    if (!e.nodeId) {
      b.events.push(ev);
      continue;
    }
    let n = nodeBuckets.get(e.nodeId);
    if (!n) {
      n = { id: e.nodeId, title: e.nodeTitle ?? "Nœud", deleted: false, events: [], eventCount: 0 };
      nodeBuckets.set(e.nodeId, n);
      b.nodes.push(n);
    }
    if (e.nodeTitle) n.title = e.nodeTitle;
    n.eventCount++;
    n.events.push(ev);
    if (e.kind === "node_deleted") n.deleted = true;
  }
  if (nodeBuckets.size) {
    const alive = new Set((await prisma.mindNode.findMany({ where: { id: { in: [...nodeBuckets.keys()] } }, select: { id: true } })).map((n) => n.id));
    for (const n of nodeBuckets.values()) if (!alive.has(n.id)) n.deleted = true;
  }
  const mapList = [...mBuckets.values()].sort((x, y) => y.total - x.total || x.title.localeCompare(y.title, "fr"));
  for (const m of mapList) {
    m.nodes.sort((x, y) => y.eventCount - x.eventCount || x.title.localeCompare(y.title, "fr"));
    for (const n of m.nodes) if (n.events.length > EVENTS_PER_ITEM) {
      n.events = n.events.slice(-EVENTS_PER_ITEM);
      truncated = true;
    }
  }

  // --- Synthèse ----------------------------------------------------------------------------
  const totals = sumCounts(projectList.map((p) => p.counts));
  for (const m of mapList) {
    totals.nodesCreated += m.counts.nodesCreated;
    totals.nodesChanged += m.counts.nodesChanged;
    totals.nodesDeleted += m.counts.nodesDeleted;
    totals.notesEdited += m.counts.notesEdited;
  }
  const days: ActivityReport["days"] = [];
  for (let d = window.from; d <= window.to; d = addDays(d, 1)) days.push({ day: d, ...(dayCounts.get(d) ?? { tasks: 0, maps: 0, other: 0 }) });

  return {
    from: window.from,
    to: window.to,
    label: window.label,
    scope: all ? "all" : "mine",
    totals: { ...totals, events: projectList.reduce((a, p) => a + p.total, 0) + mapList.reduce((a, m) => a + m.total, 0) },
    people: [...people.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 50),
    days,
    projects: projectList,
    maps: mapList,
    truncated,
  };
}
