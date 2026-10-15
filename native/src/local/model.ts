import type { DeliverableStatus, TaskStatus } from "@prisma/client";
import {
  aggregate,
  hasHtmlContent,
  isMyTask,
  toMemberDto,
  toProjectDto,
  toTaskDto,
  type MemberDto,
  type ProjectDto,
  type ProjectRow,
  type ProjectSummary,
  type TaskDto,
  type TaskRow,
} from "@/lib/shared/project-model";
import { NO_PROJECT_LABEL, dayString } from "@/lib/shared/task-model";
import { sanitizeNotes } from "@/lib/sanitize";
import type { MindMapDto, MindMapSharing, MindMapSummary, MindNodeDto } from "@/lib/mindmaps";
import { mapAccessOf, type MapAccess } from "@/lib/shared/map-access";
import type { NodeTaskDto, NodeTasksResult, OrganizerDto, OrganizerTask, TaskCommentDto, TaskDetailDto, WorkSessionDto } from "@/lib/tasks";
import type { DashboardDto, DashboardTask, Deadline } from "@/lib/dashboard";
import type { NoteDocument, NoteKind, TreeItem } from "@/lib/notes";
import type { SearchHit, SearchKind } from "@/lib/search";
import type { Store } from "./store";
import type { Profile, Row } from "./types";

/**
 * Lecture locale : reconstruit, depuis la base hors ligne, exactement les DTO
 * de l'API serveur (mêmes constructeurs partagés : src/lib/shared). Les
 * lignes locales ont les colonnes du serveur avec des dates ISO ; on les
 * « ravive » en Date là où les constructeurs l'attendent.
 */

const DATE_KEYS = new Set(["createdAt", "updatedAt", "startDate", "dueDate", "closedAt", "expectedStart", "expectedEnd", "deliveredAt", "date", "readAt"]);

export function revive<T extends Row>(row: T): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = DATE_KEYS.has(k) && typeof v === "string" ? new Date(v) : v;
  return out as T;
}

export const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
const byCreated = (a: Row, b: Row) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
const finished = (s: string) => s === "DONE" || s === "CLOSED";

export class LocalModel {
  constructor(private store: Store) {}

  get me(): Profile {
    const u = this.store.meta.user;
    if (!u) throw new Error("Non connecté");
    return u;
  }

  /** Nom d'un compte : moi, sinon une fiche membre rattachée à ce compte. */
  userName(userId: string | null | undefined): string {
    if (!userId) return "Utilisateur";
    if (userId === this.store.meta.user?.id) return this.me.name;
    return this.store.where("ProjectMember", (m) => m.userId === userId)[0]?.name ?? "Utilisateur";
  }
  userAvatar(userId: string | null | undefined): string | null {
    return userId && userId === this.store.meta.user?.id ? this.me.avatarUrl : null;
  }

  // --- Lignes « façon Prisma » ------------------------------------------------------
  taskRow(t: Row): TaskRow {
    return {
      ...revive(t),
      _count: { comments: this.store.where("TaskComment", (c) => c.taskId === t.id).length },
      nodes: this.store.where("MindNodeTask", (l) => l.taskId === t.id).map((l) => ({ nodeId: l.nodeId })),
      contributors: this.store.where("TaskContributor", (c) => c.taskId === t.id).map((c) => ({ memberId: c.memberId })),
    } as unknown as TaskRow;
  }

  memberRow(m: Row): Parameters<typeof toMemberDto>[0] {
    return { ...revive(m), user: m.userId ? { avatarUrl: this.userAvatar(m.userId) } : null } as Parameters<typeof toMemberDto>[0];
  }

  private docRow(d: Row) {
    return { ...revive(d), uploadedBy: d.uploadedById ? { id: d.uploadedById, name: this.userName(d.uploadedById) } : null };
  }

  projectRow(projectId: string): ProjectRow | null {
    const p = this.store.get("Project", projectId);
    if (!p) return null;
    const tasks = this.store.where("Task", (t) => t.projectId === projectId);
    return {
      ...revive(p),
      stages: this.store
        .where("Stage", (s) => s.projectId === projectId)
        .sort(byOrder)
        .map((s) => ({
          ...revive(s),
          activities: this.store.where("Activity", (a) => a.stageId === s.id).sort(byOrder).map(revive),
          tasks: tasks.filter((t) => t.stageId === s.id).sort(byOrder).map((t) => this.taskRow(t)),
        })),
      tasks: tasks.filter((t) => !t.stageId).sort(byOrder).map((t) => this.taskRow(t)),
      members: this.store.where("ProjectMember", (m) => m.projectId === projectId).sort(byCreated).map((m) => this.memberRow(m)),
      deliverables: this.store
        .where("Deliverable", (d) => d.projectId === projectId)
        .sort(byOrder)
        .map((d) => ({ ...revive(d), documents: this.store.where("Document", (x) => x.deliverableId === d.id).sort((a, b) => -byCreated(a, b)).map((x) => this.docRow(x)) })),
      documents: this.store.where("Document", (x) => x.projectId === projectId).sort((a, b) => -byCreated(a, b)).map((x) => this.docRow(x)),
      folders: this.store.where("Folder", (f) => f.projectId === projectId).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    } as unknown as ProjectRow;
  }

  // --- Projets ------------------------------------------------------------------------
  project(projectId: string): ProjectDto | null {
    const row = this.projectRow(projectId);
    return row ? toProjectDto(row) : null;
  }

  projects(): ProjectSummary[] {
    return this.store
      .all("Project")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((p) => {
        const dto = this.project(p.id)!;
        const { stages: _s, tasks: _t, members: _m, deliverables: _d, documents: _doc, folders: _f, notes: _n, ...summary } = dto;
        void [_s, _t, _m, _d, _doc, _f, _n];
        return summary;
      });
  }

  task(taskId: string): TaskDto | null {
    const t = this.store.get("Task", taskId);
    return t ? toTaskDto(this.taskRow(t)) : null;
  }

  orphanTasks(): TaskDto[] {
    return this.store
      .where("Task", (t) => !t.projectId && t.ownerId === this.me.id)
      .sort(byOrder)
      .map((t) => toTaskDto(this.taskRow(t)));
  }

  private member(id: string | null | undefined): MemberDto | null {
    const m = id ? this.store.get("ProjectMember", id) : null;
    return m ? toMemberDto(this.memberRow(m)) : null;
  }

  private sessionDto(s: Row, dueDate: string | null): WorkSessionDto {
    const date = String(s.date).slice(0, 10);
    return { id: s.id, date, userId: s.userId, userName: this.userName(s.userId), mine: s.userId === this.me.id, late: dueDate ? date > dueDate.slice(0, 10) : false };
  }

  sessions(taskId: string): WorkSessionDto[] {
    const t = this.store.get("Task", taskId);
    return this.store
      .where("WorkSession", (s) => s.taskId === taskId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((s) => this.sessionDto(s, t?.dueDate ?? null));
  }

  taskDetail(taskId: string): TaskDetailDto | null {
    const t = this.store.get("Task", taskId);
    if (!t) return null;
    const p = t.projectId ? this.store.get("Project", t.projectId) : null;
    const members = p ? this.store.where("ProjectMember", (m) => m.projectId === p.id).sort(byCreated).map((m) => toMemberDto(this.memberRow(m))) : [];
    const stage = t.stageId ? this.store.get("Stage", t.stageId) : null;
    const activity = t.activityId ? this.store.get("Activity", t.activityId) : null;
    const comments: TaskCommentDto[] = this.store
      .where("TaskComment", (c) => c.taskId === taskId)
      .sort(byCreated)
      .map((c) => ({ id: c.id, parentId: c.parentId ?? null, authorId: c.authorId, authorName: this.userName(c.authorId), authorAvatarUrl: this.userAvatar(c.authorId), body: c.body, mentions: c.mentions ?? [], createdAt: c.createdAt }));
    const nodes = this.store
      .where("MindNodeTask", (l) => l.taskId === taskId)
      .map((l) => this.store.get("MindNode", l.nodeId))
      .filter((n): n is Row => !!n)
      .map((n) => ({ id: n.id, title: n.title, mapId: n.mapId, mapTitle: this.store.get("MindMap", n.mapId)?.title ?? "" }));
    return {
      canEdit: true,
      ...toTaskDto(this.taskRow(t)),
      project: p ? { id: p.id, name: p.name, color: p.color ?? null, ownerId: p.ownerId, members } : null,
      stage: stage ? { id: stage.id, name: stage.name } : null,
      activity: activity ? { id: activity.id, name: activity.name } : null,
      assignee: this.member(t.assigneeId),
      supervisor: this.member(t.supervisorId),
      contributors: this.store.where("TaskContributor", (c) => c.taskId === taskId).map((c) => this.member(c.memberId)).filter((m): m is MemberDto => !!m),
      comments,
      workSessions: this.sessions(taskId),
      nodes,
      notes: sanitizeNotes(t.notes ?? ""),
    };
  }

  // --- « Mes tâches » ------------------------------------------------------------------
  private people(t: Row) {
    const m = (id: string | null | undefined) => (id ? this.store.get("ProjectMember", id) : undefined);
    const assignee = m(t.assigneeId);
    const supervisor = m(t.supervisorId);
    return {
      assignee: assignee ? { name: assignee.name, userId: assignee.userId ?? null } : null,
      supervisor: supervisor ? { name: supervisor.name, userId: supervisor.userId ?? null } : null,
      contributors: this.store.where("TaskContributor", (c) => c.taskId === t.id).map((c) => ({ member: { userId: m(c.memberId)?.userId ?? null } })),
    };
  }

  private ownerOf(t: Row): string {
    return t.projectId ? (this.store.get("Project", t.projectId)?.ownerId ?? t.ownerId) : t.ownerId;
  }

  myTasks(): OrganizerDto {
    const me = this.me.id;
    const ranks = new Map(this.store.meta.ranks.map((id, i) => [id, i]));
    const PRIORITY_WEIGHT = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
    const tasks = this.store
      .where("Task", (t) => {
        if (!t.projectId) return t.ownerId === me;
        const p = this.store.get("Project", t.projectId);
        return !!p && (p.status === "ACTIVE" || p.status === "ON_HOLD");
      })
      .filter((t) => isMyTask(this.people(t), this.ownerOf(t), me))
      .map<OrganizerTask>((t) => {
        const p = t.projectId ? this.store.get("Project", t.projectId) : null;
        const people = this.people(t);
        return {
          ...toTaskDto(this.taskRow(t)),
          projectId: p?.id ?? null,
          projectName: p?.name ?? NO_PROJECT_LABEL,
          projectColor: p?.color ?? null,
          stageName: t.stageId ? (this.store.get("Stage", t.stageId)?.name ?? null) : null,
          activityName: t.activityId ? (this.store.get("Activity", t.activityId)?.name ?? null) : null,
          assigneeName: people.assignee?.name ?? null,
          roles: {
            assigned: people.assignee?.userId === me,
            supervising: people.supervisor?.userId === me,
            contributing: people.contributors.some((c) => c.member.userId === me),
            owner: !people.assignee && this.ownerOf(t) === me,
          },
          rank: ranks.get(t.id) ?? null,
          sessions: this.store
            .where("WorkSession", (s) => s.taskId === t.id && s.userId === me)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .map((s) => ({ id: s.id, date: String(s.date).slice(0, 10), late: t.dueDate ? String(s.date).slice(0, 10) > String(t.dueDate).slice(0, 10) : false })),
        };
      });
    tasks.sort((a, b) => {
      if (a.rank !== null || b.rank !== null) {
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        if (a.rank !== b.rank) return a.rank - b.rank;
      }
      const d = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      return d !== 0 ? d : PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    });
    return { tasks };
  }

  // --- Tableau de bord (même calcul que src/lib/dashboard.ts) ----------------------------
  dashboard(horizon = 30): DashboardDto {
    const me = this.me.id;
    const now = new Date();
    const DAY = 86_400_000;
    const daysLeft = (iso: string) => {
      const due = new Date(iso);
      return Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY);
    };
    const projects = this.projects();
    const activeIds = new Set(projects.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD").map((p) => p.id));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const tasks = this.store
      .where("Task", (t) => (t.projectId ? activeIds.has(t.projectId) : t.ownerId === me))
      .sort((a, b) => String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const statusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
    const myStatusCounts: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 };
    const myTasks: DashboardTask[] = [];
    const deadlines: Deadline[] = [];
    let overdueCount = 0;
    for (const t of tasks) {
      statusCounts[t.status as TaskStatus]++;
      const p = t.projectId ? projectById.get(t.projectId) : null;
      const project = p ? { id: p.id, name: p.name, color: p.color, ownerId: p.ownerId } : { id: null, name: NO_PROJECT_LABEL, color: null, ownerId: t.ownerId };
      const people = this.people(t);
      const mine = isMyTask(people, project.ownerId, me);
      if (mine) myStatusCounts[t.status as TaskStatus]++;
      // Même contrat que le serveur : mes tâches ouvertes, 100 au plus.
      if (mine && !finished(t.status) && myTasks.length < 100) {
        myTasks.push({ ...toTaskDto(this.taskRow(t)), projectId: project.id, projectName: project.name, projectColor: project.color, stageName: t.stageId ? (this.store.get("Stage", t.stageId)?.name ?? null) : null, assigneeName: people.assignee?.name ?? null });
      }
      if (t.dueDate && !finished(t.status)) {
        const left = daysLeft(t.dueDate);
        if (left < 0) overdueCount++;
        if (left <= horizon) deadlines.push({ kind: "task", id: t.id, name: t.name, projectId: project.id, projectName: project.name, projectColor: project.color, dueDate: t.dueDate, status: t.status, assigneeName: people.assignee?.name ?? null, daysLeft: left, mine });
      }
    }
    const deliverableCounts: Record<DeliverableStatus, number> = { PLANNED: 0, IN_PROGRESS: 0, DELIVERED: 0, VALIDATED: 0 };
    for (const d of this.store.where("Deliverable", (x) => activeIds.has(x.projectId))) {
      deliverableCounts[d.status as DeliverableStatus]++;
      if (d.expectedEnd && (d.status === "PLANNED" || d.status === "IN_PROGRESS")) {
        const left = daysLeft(d.expectedEnd);
        if (left < 0) overdueCount++;
        if (left <= horizon) {
          const p = projectById.get(d.projectId)!;
          const a = d.assigneeId ? this.store.get("ProjectMember", d.assigneeId) : null;
          deadlines.push({ kind: "deliverable", id: d.id, name: d.name, projectId: p.id, projectName: p.name, projectColor: p.color, dueDate: d.expectedEnd, status: d.status, assigneeName: a?.name ?? null, daysLeft: left, mine: a?.userId === me });
        }
      }
    }
    deadlines.sort((a, b) => a.daysLeft - b.daysLeft);
    const next7Count = deadlines.filter((d) => d.daysLeft >= 0 && d.daysLeft <= 7).length;
    const active = projects.filter((p) => activeIds.has(p.id));
    const sum = tasks.reduce((a, t) => a + (t.progress ?? 0), 0);
    return {
      projects,
      myTasks,
      myOpenCount: myStatusCounts.TODO + myStatusCounts.IN_PROGRESS,
      deadlines: deadlines.slice(0, 100),
      next7Count,
      statusCounts,
      myStatusCounts,
      deliverableCounts,
      overdueCount,
      globalProgress: { percent: tasks.length ? Math.round(sum / tasks.length) : 0, total: active.reduce((a, p) => a + p.progress.total, 0), done: active.reduce((a, p) => a + p.progress.done, 0) },
    };
  }

  // --- Cartes mentales ------------------------------------------------------------------
  nodeDto(n: Row): MindNodeDto {
    const links = this.store.where("MindNodeTask", (l) => l.nodeId === n.id);
    const statuses = links.map((l) => this.store.get("Task", l.taskId)?.status).filter(Boolean);
    return {
      id: n.id,
      parentId: n.parentId ?? null,
      title: n.title,
      notes: sanitizeNotes(n.notes ?? ""),
      color: n.color ?? null,
      collapsed: !!n.collapsed,
      status: n.status ?? "OPEN",
      order: n.order ?? 0,
      x: n.x ?? null,
      y: n.y ?? null,
      taskCount: statuses.length,
      openTaskCount: statuses.filter((s) => s !== "CLOSED").length,
      updatedAt: n.updatedAt,
    };
  }

  /** Mon droit sur une carte : propriétaire, sinon mon partage synchronisé (MindMapShare). */
  mapAccess(mapId: string): MapAccess | null {
    const m = this.store.get("MindMap", mapId);
    if (!m) return null;
    const me = this.store.meta.user?.id ?? "";
    return mapAccessOf(m.ownerId, me, this.store.get("MindMapShare", `${mapId}:${me}`)?.permission) ?? "read";
  }

  /** Champs de partage du DTO (comme src/lib/mindmaps.ts) ; le nom du propriétaire vient de la ligne MindMap synchronisée. */
  private mapSharing(m: Row): MindMapSharing {
    const access = this.mapAccess(m.id) ?? "read";
    return {
      access,
      owner: access === "owner" ? null : { id: m.ownerId, name: m.ownerName ?? this.userName(m.ownerId), avatarUrl: m.ownerAvatarUrl ?? null },
      sharedWith: access === "owner" ? this.store.where("MindMapShare", (s) => s.mapId === m.id).length : 0,
    };
  }

  mindmaps(): MindMapSummary[] {
    return this.store
      .all("MindMap")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((m) => ({ id: m.id, title: m.title, nodeCount: this.store.where("MindNode", (n) => n.mapId === m.id).length, createdAt: m.createdAt, updatedAt: m.updatedAt, ...this.mapSharing(m) }));
  }

  mindmap(mapId: string): MindMapDto | null {
    const m = this.store.get("MindMap", mapId);
    if (!m) return null;
    const nodes = this.store.where("MindNode", (n) => n.mapId === mapId).sort(byOrder);
    const root = nodes.find((n) => !n.parentId);
    if (!root) return null;
    return { id: m.id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt, rootId: root.id, nodes: nodes.map((n) => this.nodeDto(n)), ...this.mapSharing(m) };
  }

  nodeTasks(nodeId: string): NodeTasksResult {
    const order = { TODO: 0, IN_PROGRESS: 1, DONE: 2, CLOSED: 3 } as Record<string, number>;
    const tasks = this.store
      .where("MindNodeTask", (l) => l.nodeId === nodeId)
      .map((l) => this.store.get("Task", l.taskId))
      .filter((t): t is Row => !!t)
      .sort((a, b) => order[a.status] - order[b.status] || byCreated(a, b))
      .map<NodeTaskDto>((t) => {
        const p = t.projectId ? this.store.get("Project", t.projectId) : null;
        return { ...toTaskDto(this.taskRow(t)), projectName: p?.name ?? NO_PROJECT_LABEL, projectColor: p?.color ?? null };
      });
    return { nodeId, tasks, taskCount: tasks.length, openTaskCount: tasks.filter((t) => t.status !== "CLOSED").length };
  }

  // --- Prise de notes (même arborescence que src/lib/notes.ts) ------------------------------
  private taskItem(t: Row): TreeItem {
    return { ref: `task:${t.id}`, kind: "task", id: t.id, title: t.name, hint: t.status === "DONE" ? "terminée" : t.status === "CLOSED" ? "clôturée" : t.status === "IN_PROGRESS" ? "en cours" : undefined, hasChildren: false, hasNotes: hasHtmlContent(t.notes ?? "") };
  }

  private nodeChildren(nodeId: string): TreeItem[] {
    return this.store
      .where("MindNode", (n) => n.parentId === nodeId)
      .sort(byOrder)
      .map((n) => ({ ref: `node:${n.id}`, kind: "node" as const, id: n.id, title: n.title, hint: n.status === "CLOSED" ? "fermé" : n.status === "WATCH" ? "à surveiller" : undefined, hasChildren: this.store.where("MindNode", (c) => c.parentId === n.id).length > 0, hasNotes: hasHtmlContent(n.notes ?? "") }));
  }

  treeChildren(ref: string): TreeItem[] {
    const [kind, id] = ref === "root" ? ["root", ""] : [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    switch (kind) {
      case "root":
        return [
          { ref: "section:mindmaps", kind: "section", id: "mindmaps", title: "Cartes mentales", hasChildren: true, hasNotes: false },
          { ref: "section:projects", kind: "section", id: "projects", title: "Projets", hasChildren: true, hasNotes: false },
        ];
      case "section":
        if (id === "mindmaps") {
          return this.store
            .all("MindMap")
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .map((m) => {
              const nodes = this.store.where("MindNode", (n) => n.mapId === m.id);
              const root = nodes.find((n) => !n.parentId);
              const shared = m.ownerId !== this.store.meta.user?.id ? ` · partagée par ${m.ownerName ?? this.userName(m.ownerId)}` : "";
              return { ref: `mindmap:${m.id}`, kind: "mindmap" as const, id: m.id, title: m.title, hint: `${nodes.length} nœud${nodes.length > 1 ? "s" : ""}${shared}`, hasChildren: nodes.length > 1, hasNotes: hasHtmlContent(root?.notes ?? "") };
            });
        }
        if (id === "projects") {
          const orphans = this.store.where("Task", (t) => !t.projectId && t.ownerId === this.me.id).length;
          const items: TreeItem[] = this.store
            .all("Project")
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .map((p) => ({
              ref: `project:${p.id}`,
              kind: "project" as const,
              id: p.id,
              title: p.name,
              hint: p.status === "ARCHIVED" ? "archivé" : p.status === "DONE" ? "terminé" : p.status === "ON_HOLD" ? "en pause" : undefined,
              color: p.color ?? null,
              hasChildren: this.store.where("Stage", (s) => s.projectId === p.id).length + this.store.where("Task", (t) => t.projectId === p.id).length > 0,
              hasNotes: hasHtmlContent(p.notes ?? ""),
            }));
          items.push({ ref: "section:orphans", kind: "section", id: "orphans", title: NO_PROJECT_LABEL, hint: `${orphans} tâche${orphans > 1 ? "s" : ""}`, hasChildren: orphans > 0, hasNotes: false });
          return items;
        }
        return this.store.where("Task", (t) => !t.projectId && t.ownerId === this.me.id).sort(byOrder).map((t) => this.taskItem(t));
      case "mindmap": {
        const root = this.store.where("MindNode", (n) => n.mapId === id && !n.parentId)[0];
        return root ? this.nodeChildren(root.id) : [];
      }
      case "node":
        return this.nodeChildren(id);
      case "project":
        return [
          ...this.store
            .where("Stage", (s) => s.projectId === id)
            .sort(byOrder)
            .map((s) => ({ ref: `stage:${s.id}`, kind: "stage" as const, id: s.id, title: s.name, hasChildren: this.store.where("Activity", (a) => a.stageId === s.id).length + this.store.where("Task", (t) => t.stageId === s.id).length > 0, hasNotes: hasHtmlContent(s.notes ?? "") })),
          ...this.store.where("Task", (t) => t.projectId === id && !t.stageId).sort(byOrder).map((t) => this.taskItem(t)),
        ];
      case "stage":
        return [
          ...this.store
            .where("Activity", (a) => a.stageId === id)
            .sort(byOrder)
            .map((a) => ({ ref: `activity:${a.id}`, kind: "activity" as const, id: a.id, title: a.name, hasChildren: this.store.where("Task", (t) => t.activityId === a.id).length > 0, hasNotes: hasHtmlContent(a.notes ?? "") })),
          ...this.store.where("Task", (t) => t.stageId === id && !t.activityId).sort(byOrder).map((t) => this.taskItem(t)),
        ];
      case "activity":
        return this.store.where("Task", (t) => t.activityId === id).sort(byOrder).map((t) => this.taskItem(t));
      default:
        return [];
    }
  }

  noteDocument(ref: string): NoteDocument | null {
    const i = ref.indexOf(":");
    const kind = (ref === "root" ? "root" : ref.slice(0, i)) as NoteKind;
    const id = ref === "root" ? "" : ref.slice(i + 1);
    const base = { ref, kind, id, editable: true };
    const SECTIONS = { mindmaps: "Cartes mentales", projects: "Projets", orphans: NO_PROJECT_LABEL } as Record<string, string>;
    const crumbMaps = { ref: "section:mindmaps", title: "Cartes mentales" };
    const crumbProjects = { ref: "section:projects", title: "Projets" };
    switch (kind) {
      case "root":
        return { ...base, title: "Prise de notes", breadcrumb: [], href: null, notes: "", editable: false, updatedAt: null };
      case "section":
        return { ...base, title: SECTIONS[id] ?? id, breadcrumb: id === "orphans" ? [crumbProjects] : [], href: id === "mindmaps" ? "/mindmaps" : id === "projects" ? "/projects" : "/projects/sans-projet", notes: "", editable: false, updatedAt: null };
      case "mindmap": {
        const m = this.store.get("MindMap", id);
        if (!m) return null;
        const root = this.store.where("MindNode", (n) => n.mapId === id && !n.parentId)[0];
        return { ...base, editable: this.mapAccess(id) !== "read", title: m.title, breadcrumb: [crumbMaps], href: `/mindmaps/${id}`, notes: sanitizeNotes(root?.notes ?? ""), updatedAt: root?.updatedAt ?? m.updatedAt };
      }
      case "node": {
        const n = this.store.get("MindNode", id);
        if (!n) return null;
        if (!n.parentId) return this.noteDocument(`mindmap:${n.mapId}`);
        const map = this.store.get("MindMap", n.mapId);
        const path: Array<{ ref: string; title: string }> = [];
        for (let cur = n.parentId as string | null; cur; ) {
          const p = this.store.get("MindNode", cur);
          if (!p) break;
          path.unshift(p.parentId ? { ref: `node:${p.id}`, title: p.title } : { ref: `mindmap:${n.mapId}`, title: map?.title ?? "" });
          cur = p.parentId ?? null;
        }
        return { ...base, editable: this.mapAccess(n.mapId) !== "read", title: n.title, breadcrumb: [crumbMaps, ...path], href: `/mindmaps/${n.mapId}?node=${n.id}`, notes: sanitizeNotes(n.notes ?? ""), updatedAt: n.updatedAt };
      }
      case "project": {
        const p = this.store.get("Project", id);
        return p ? { ...base, title: p.name, breadcrumb: [crumbProjects], href: `/projects/${id}`, notes: sanitizeNotes(p.notes ?? ""), updatedAt: p.updatedAt } : null;
      }
      case "stage": {
        const s = this.store.get("Stage", id);
        const p = s ? this.store.get("Project", s.projectId) : null;
        return s && p ? { ...base, title: s.name, breadcrumb: [crumbProjects, { ref: `project:${p.id}`, title: p.name }], href: `/projects/${p.id}#plan`, notes: sanitizeNotes(s.notes ?? ""), updatedAt: s.updatedAt } : null;
      }
      case "activity": {
        const a = this.store.get("Activity", id);
        const s = a ? this.store.get("Stage", a.stageId) : null;
        const p = s ? this.store.get("Project", s.projectId) : null;
        return a && s && p ? { ...base, title: a.name, breadcrumb: [crumbProjects, { ref: `project:${p.id}`, title: p.name }, { ref: `stage:${s.id}`, title: s.name }], href: `/projects/${p.id}#plan`, notes: sanitizeNotes(a.notes ?? ""), updatedAt: a.updatedAt } : null;
      }
      case "task": {
        const t = this.store.get("Task", id);
        if (!t) return null;
        const p = t.projectId ? this.store.get("Project", t.projectId) : null;
        const s = t.stageId ? this.store.get("Stage", t.stageId) : null;
        const a = t.activityId ? this.store.get("Activity", t.activityId) : null;
        const breadcrumb = [crumbProjects, p ? { ref: `project:${p.id}`, title: p.name } : { ref: "section:orphans", title: NO_PROJECT_LABEL }];
        if (s) breadcrumb.push({ ref: `stage:${s.id}`, title: s.name });
        if (a) breadcrumb.push({ ref: `activity:${a.id}`, title: a.name });
        return { ...base, title: t.name, breadcrumb, href: `/tasks/${id}`, notes: sanitizeNotes(t.notes ?? ""), updatedAt: t.updatedAt };
      }
    }
    return null;
  }

  // --- Recherche locale (mêmes règles que src/lib/search.ts) --------------------------------
  search(rawQuery: string, kinds?: SearchKind[], limit = 6): SearchHit[] {
    const q = rawQuery.trim().slice(0, 100).toLowerCase();
    if (q.length < 2) return [];
    const all: SearchKind[] = ["project", "task", "node", "mindmap"];
    const want = kinds?.length ? kinds.filter((k) => all.includes(k)) : all;
    const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const has = (s: unknown) => typeof s === "string" && s.toLowerCase().includes(q);
    const excerpt = (html: string) => {
      const t = text(html);
      const i = t.toLowerCase().indexOf(q);
      const start = Math.max(0, i - 30);
      return t ? (start > 0 ? "…" : "") + t.slice(start, start + 90) + (start + 90 < t.length ? "…" : "") : "";
    };
    const recent = (a: Row, b: Row) => String(b.updatedAt).localeCompare(String(a.updatedAt));
    const hits: SearchHit[] = [];
    if (want.includes("project")) {
      for (const p of this.store.where("Project", (p) => has(p.name) || has(p.description)).sort(recent).slice(0, limit)) {
        hits.push({ kind: "project", id: p.id, title: p.name, subtitle: excerpt(p.description ?? "") || "Projet", href: `/projects/${p.id}`, status: p.status, color: p.color ?? null });
      }
    }
    if (want.includes("task")) {
      for (const t of this.store.where("Task", (t) => has(t.name) || has(t.description)).sort(recent).slice(0, limit)) {
        const p = t.projectId ? this.store.get("Project", t.projectId) : null;
        const s = t.stageId ? this.store.get("Stage", t.stageId) : null;
        const ctx = [p?.name ?? NO_PROJECT_LABEL, s?.name].filter(Boolean).join(" › ");
        const ex = excerpt(t.description ?? "");
        hits.push({ kind: "task", id: t.id, title: t.name, subtitle: ex && !String(t.name).toLowerCase().includes(q) ? `${ctx} — ${ex}` : ctx, href: `/tasks/${t.id}`, status: t.status, color: p?.color ?? null });
      }
    }
    if (want.includes("node")) {
      for (const n of this.store.where("MindNode", (n) => !!n.parentId && (has(n.title) || has(text(n.notes ?? "")))).sort(recent).slice(0, limit)) {
        const m = this.store.get("MindMap", n.mapId);
        const ex = excerpt(n.notes ?? "");
        hits.push({ kind: "node", id: n.id, title: n.title, subtitle: ex && !String(n.title).toLowerCase().includes(q) ? `${m?.title ?? ""} — ${ex}` : `Carte « ${m?.title ?? ""} »`, href: `/mindmaps/${n.mapId}?node=${n.id}`, status: n.status });
      }
    }
    if (want.includes("mindmap")) {
      for (const m of this.store.where("MindMap", (m) => has(m.title)).sort(recent).slice(0, limit)) hits.push({ kind: "mindmap", id: m.id, title: m.title, subtitle: "Carte mentale", href: `/mindmaps/${m.id}` });
    }
    return hits;
  }

  /** Aggrégat utilitaire (réexport) pour les tests. */
  static aggregate = aggregate;
  static dayString = dayString;
}
