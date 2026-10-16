import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { isAdmin } from "@/lib/roles";
import { htmlToText } from "@/lib/sanitize";
import { getProject, getProjectAdmin, listAllProjectsAdmin, listProjects, taskAccessWhere } from "@/lib/projects";
import { getMyTasks, getTaskDetail, listAllTasksAdmin, listTeamTasks, tasksOfUsersWhere, type OverviewTask } from "@/lib/tasks";
import { getMindMap, listMindMaps } from "@/lib/mindmaps";
import { children as noteChildren, getDocument } from "@/lib/notes";
import { getDashboard } from "@/lib/dashboard";
import { search } from "@/lib/search";
import { listUsersAdmin, reportIdsOf } from "@/lib/users";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import { WRITE_TOOLS } from "@/lib/mcp-write";
import { getActivity } from "@/lib/activity";
import { listMapEvents } from "@/lib/map-events";
import { ACTIVITY_PRESETS } from "@/lib/shared/activity-period";

/**
 * Serveur MCP (Model Context Protocol) de Second Brain : Claude Desktop (ou
 * tout client MCP) interroge les projets, tâches, cartes mentales et notes
 * de l'utilisateur, **en lecture seule**, au nom du propriétaire de la clé
 * d'accès (Préférences → Connecteur Claude).
 *
 * Transport « Streamable HTTP » sans état : POST JSON-RPC 2.0 sur
 * /api/v1/mcp, réponse JSON (pas de flux SSE).
 *
 * Périmètre : exactement celui de l'utilisateur dans l'application. Un
 * administrateur peut analyser des projets / tâches qui ne sont pas les siens
 * en le demandant explicitement (`admin_access: true`) ; sans ce drapeau,
 * même un administrateur ne voit que son propre périmètre.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_SERVER_INFO = { name: "second-brain", title: "Second Brain", version: "1.0.0" };

export const MCP_INSTRUCTIONS =
  "Second Brain : gestion de projets (projets › étapes › activités › tâches, livrables, équipe), cartes mentales et prise de notes. " +
  "Lecture : commencez par list_projects / list_my_tasks / search, puis get_project, get_task, get_mind_map ou read_note. " +
  "Pour « que s'est-il passé » sur une période (jour, semaine, mois, dates libres), utilisez get_activity : un seul appel consolide tâches, cartes mentales, réunions, risques, livrables et documents ; rédigez ensuite la synthèse. get_map_history donne l'historique détaillé d'une carte. " +
  "Écriture (clé autorisée) : create_task, update_task, bulk_update_tasks (ex. assigner toutes les tâches d'un projet), delete_task, add_comment, create_project, update_project, create_stage, save_note, create_meeting, update_meeting (compte-rendu), decide_meeting, upsert_risk, edit_mind_map, send_message ; " +
  "pour tout le reste, api_request appelle n'importe quelle route de l'API (consultez api_reference). Les personnes se désignent par nom, e-mail ou id. Confirmez avec l'utilisateur avant une suppression ou une modification en masse. " +
  "Les dates sont au format ISO. Statuts de tâche : TODO (à faire), IN_PROGRESS (en cours), DONE (terminée), CLOSED (clôturée). " +
  "Un administrateur peut analyser les projets des autres en passant admin_access: true (à n'utiliser que si l'utilisateur le demande explicitement).";

type JsonSchema = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  adminOnly?: boolean;
  run: (user: User, args: Record<string, unknown>) => Promise<unknown>;
};

const ADMIN_FLAG = {
  admin_access: {
    type: "boolean",
    description: "Administrateurs uniquement : accéder à un projet/tâche hors de votre périmètre. À n'utiliser que sur demande explicite de l'utilisateur.",
  },
};

// --- Aides ---------------------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string, required = true): string {
  const v = args[key];
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
  if (required) throw new ApiError(400, "BAD_ARGUMENT", `Paramètre « ${key} » requis.`);
  return "";
}

function wantsAdmin(user: User, args: Record<string, unknown>): boolean {
  if (args.admin_access !== true) return false;
  if (!isAdmin(user)) throw new ApiError(403, "FORBIDDEN", "admin_access est réservé aux administrateurs.");
  return true;
}

const text = (html: string | null | undefined, max = 8000) => (html ? htmlToText(html, max) : "");

function nameOf(members: ProjectDto["members"], id: string | null) {
  return id ? (members.find((m) => m.id === id)?.name ?? null) : null;
}

function taskForAi(t: TaskDto, members: ProjectDto["members"]) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    priority: t.priority,
    complexity: t.complexity,
    progress: t.progress,
    startDate: t.startDate,
    dueDate: t.dueDate,
    closedAt: t.closedAt,
    assignee: nameOf(members, t.assigneeId),
    supervisor: nameOf(members, t.supervisorId),
    contributors: t.contributorIds.map((id) => nameOf(members, id)).filter(Boolean),
    description: t.description || undefined,
    comments: t.commentCount,
    hasNotes: t.hasNotes,
    updatedAt: t.updatedAt,
  };
}

function projectForAi(p: ProjectDto & { ownerName?: string }) {
  const m = p.members;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    owner: p.ownerName ?? m.find((x) => x.userId === p.ownerId)?.name ?? undefined,
    description: p.description || undefined,
    startDate: p.startDate,
    dueDate: p.dueDate,
    progress: p.progress,
    notes: text(p.notes) || undefined,
    members: m.map((x) => ({ name: x.name, role: x.role, email: x.email, hasAccount: !!x.userId })),
    stages: p.stages.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || undefined,
      startDate: s.startDate,
      dueDate: s.dueDate,
      progress: s.progress,
      hasNotes: s.hasNotes,
      activities: s.activities.map((a) => ({ id: a.id, name: a.name, description: a.description || undefined, progress: a.progress, hasNotes: a.hasNotes, tasks: a.tasks.map((t) => taskForAi(t, m)) })),
      tasks: s.tasks.map((t) => taskForAi(t, m)),
    })),
    tasksWithoutStage: p.tasks.map((t) => taskForAi(t, m)),
    deliverables: p.deliverables.map((d) => ({
      name: d.name,
      status: d.status,
      stage: p.stages.find((s) => s.id === d.stageId)?.name ?? null,
      assignee: nameOf(m, d.assigneeId),
      expectedStart: d.expectedStart,
      expectedEnd: d.expectedEnd,
      deliveredAt: d.deliveredAt,
      description: d.description || undefined,
      documents: d.documents.map((doc) => doc.name),
    })),
    documents: p.documents.map((d) => ({ name: d.name, type: d.mimeType, size: d.size, uploadedBy: d.uploadedBy?.name ?? null, createdAt: d.createdAt })),
  };
}

function overviewForAi(t: OverviewTask) {
  return {
    id: t.id,
    name: t.name,
    project: t.projectName || null,
    stage: t.stageName,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    startDate: t.startDate,
    dueDate: t.dueDate,
    closedAt: t.closedAt,
    owner: t.ownerName,
    assignee: t.assigneeName,
    supervisor: t.supervisorName,
    contributors: t.contributorNames,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function filterTasks<T extends { status: string; dueDate: string | null; priority: string }>(tasks: T[], args: Record<string, unknown>): T[] {
  let out = tasks;
  const status = typeof args.status === "string" ? args.status : "";
  if (status === "open") out = out.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  else if (status) out = out.filter((t) => t.status === status);
  if (args.overdue === true) out = out.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today() && (t.status === "TODO" || t.status === "IN_PROGRESS"));
  if (typeof args.due_within_days === "number") {
    const limit = new Date(Date.now() + args.due_within_days * 86400_000).toISOString().slice(0, 10);
    out = out.filter((t) => t.dueDate && t.dueDate.slice(0, 10) <= limit);
  }
  if (typeof args.priority === "string") out = out.filter((t) => t.priority === args.priority);
  return out;
}

const TASK_FILTERS = {
  status: { type: "string", enum: ["open", "TODO", "IN_PROGRESS", "DONE", "CLOSED"], description: "« open » = à faire ou en cours." },
  overdue: { type: "boolean", description: "Uniquement les tâches ouvertes en retard." },
  due_within_days: { type: "number", minimum: 0, maximum: 365, description: "Échéance dans les N prochains jours (ou dépassée)." },
  priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  limit: { type: "number", minimum: 1, maximum: 500, description: "Nombre maximum de tâches (200 par défaut)." },
};

function limitOf(args: Record<string, unknown>, def = 200) {
  return typeof args.limit === "number" ? Math.max(1, Math.min(500, Math.floor(args.limit))) : def;
}

// --- Outils -------------------------------------------------------------------------------------

export const TOOLS: Tool[] = [
  {
    name: "get_activity",
    title: "Rapport d'activité sur une période",
    description:
      "Tout ce qui a évolué sur une fenêtre de temps : tâches (créées, terminées, clôturées, rouvertes, replanifiées, affectations, commentaires, autres modifications, avec les messages de la piste d'audit), cartes mentales (nœuds créés, modifiés, supprimés, notes, tâches rattachées, partages), réunions (créées, compte-rendu modifié, validations / refus), risques et opportunités, livrables, documents, étapes et projets créés. " +
      "Regroupé par projet et par carte, avec totaux, personnes actives et activité par jour. Période : period (" +
      ACTIVITY_PRESETS.map((p) => `${p.key} = ${p.label}`).join(", ") +
      ") ou from / to (AAAA-MM-JJ, inclus, heure de Paris ; 366 jours au plus). Défaut : 7 derniers jours.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ACTIVITY_PRESETS.map((p) => p.key) },
        from: { type: "string", description: "Début inclus (AAAA-MM-JJ)." },
        to: { type: "string", description: "Fin incluse (AAAA-MM-JJ), aujourd'hui par défaut." },
        project_id: { type: "string", description: "Limiter à un projet." },
        map_id: { type: "string", description: "Limiter à une carte mentale." },
        admin_access: { type: "boolean", description: "Administrateurs : toute la plateforme (sur demande explicite seulement)." },
      },
    },
    run: async (user, args) =>
      getActivity(user, {
        period: typeof args.period === "string" ? args.period : null,
        from: typeof args.from === "string" ? args.from : null,
        to: typeof args.to === "string" ? args.to : null,
        projectId: typeof args.project_id === "string" ? args.project_id : null,
        mapId: typeof args.map_id === "string" ? args.map_id : null,
        all: wantsAdmin(user, args),
      }),
  },
  {
    name: "get_map_history",
    title: "Historique d'une carte mentale",
    description: "Piste d'audit d'une carte (ou d'un de ses nœuds) : qui a créé, renommé, déplacé, supprimé un nœud, modifié ses notes, son statut, rattaché une tâche, partagé la carte, et quand. Le plus récent d'abord.",
    inputSchema: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 1000 } }, required: ["map_id"] },
    run: async (user, args) =>
      listMapEvents(user.id, String(args.map_id), { nodeId: typeof args.node_id === "string" ? args.node_id : undefined, limit: typeof args.limit === "number" ? args.limit : 200 }),
  },
  {
    name: "whoami",
    title: "Mon compte",
    description: "Compte connecté : nom, e-mail, administrateur ou non, nombre de N-1 (périmètre de lecture).",
    inputSchema: { type: "object", properties: {} },
    run: async (user) => ({
      name: user.name,
      email: user.email,
      isAdmin: isAdmin(user),
      directReports: await prisma.user.count({ where: { managerId: user.id } }),
      today: today(),
    }),
  },
  {
    name: "get_dashboard",
    title: "Tableau de bord",
    description: "Synthèse du tableau de bord : tâches ouvertes, en retard, échéances à venir, avancement des projets, cartes récentes.",
    inputSchema: { type: "object", properties: { horizon_days: { type: "number", minimum: 1, maximum: 120, description: "Horizon des échéances (30 par défaut)." } } },
    run: async (user, args) => getDashboard(user.id, { horizonDays: typeof args.horizon_days === "number" ? args.horizon_days : 30 }),
  },
  {
    name: "list_projects",
    title: "Lister les projets",
    description: "Projets accessibles (propriétaire ou membre) avec statut, dates, avancement et compteurs. Avec admin_access (administrateur) : tous les projets de la plateforme.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"] },
        query: { type: "string", description: "Filtre sur le nom." },
        ...ADMIN_FLAG,
      },
    },
    run: async (user, args) => {
      const admin = wantsAdmin(user, args);
      let rows: Array<{ id: string; name: string; status: string; description: string; startDate: string | null; dueDate: string | null; progress: unknown; stageCount: number; memberCount: number; deliverableCount: number; updatedAt: string; ownerName?: string; ownerId: string }> = admin
        ? await listAllProjectsAdmin(user)
        : await listProjects(user.id);
      if (typeof args.status === "string") rows = rows.filter((p) => p.status === args.status);
      const q = str(args, "query", false).toLowerCase();
      if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        owner: p.ownerName ?? (p.ownerId === user.id ? user.name : undefined),
        mine: p.ownerId === user.id,
        description: p.description || undefined,
        startDate: p.startDate,
        dueDate: p.dueDate,
        progress: p.progress,
        stages: p.stageCount,
        members: p.memberCount,
        deliverables: p.deliverableCount,
        updatedAt: p.updatedAt,
      }));
    },
  },
  {
    name: "get_project",
    title: "Détail d'un projet",
    description:
      "Projet complet : notes, équipe, étapes › activités › tâches (statut, priorité, dates, responsables), tâches sans étape, livrables, documents. Avec admin_access (administrateur) : n'importe quel projet.",
    inputSchema: { type: "object", properties: { project_id: { type: "string" }, ...ADMIN_FLAG }, required: ["project_id"] },
    run: async (user, args) => {
      const id = str(args, "project_id");
      const p = wantsAdmin(user, args) ? await getProjectAdmin(user, id) : await getProject(user.id, id);
      return projectForAi(p);
    },
  },
  {
    name: "list_my_tasks",
    title: "Mes tâches",
    description: "Tâches qui me concernent (responsable, superviseur, contributeur, ou créées par moi sans affectation), tous projets et sans projet, avec filtres.",
    inputSchema: { type: "object", properties: TASK_FILTERS },
    run: async (user, args) => {
      const org = await getMyTasks(user.id);
      const tasks = filterTasks(org.tasks, args).slice(0, limitOf(args));
      return tasks.map((t) => ({
        id: t.id,
        name: t.name,
        project: (t as { projectName?: string | null }).projectName ?? null,
        status: t.status,
        priority: t.priority,
        complexity: t.complexity,
        progress: t.progress,
        startDate: t.startDate,
        dueDate: t.dueDate,
        closedAt: t.closedAt,
      }));
    },
  },
  {
    name: "list_tasks",
    title: "Tâches d'une personne ou de toute la plateforme",
    description:
      "Vue d'ensemble des tâches avec responsables. Sans admin_access : les tâches de mes N-1 (manager). Avec admin_access (administrateur) : toutes les tâches de la plateforme ; `person` filtre sur un nom (responsable, superviseur, contributeur ou propriétaire).",
    inputSchema: { type: "object", properties: { person: { type: "string" }, project_id: { type: "string" }, ...TASK_FILTERS, ...ADMIN_FLAG } },
    run: async (user, args) => {
      let rows: OverviewTask[];
      if (wantsAdmin(user, args)) rows = await listAllTasksAdmin(user);
      else rows = (await listTeamTasks(user.id)).tasks;
      const person = str(args, "person", false).toLowerCase();
      if (person) rows = rows.filter((t) => [t.ownerName, t.assigneeName, t.supervisorName, ...t.contributorNames].some((n) => n?.toLowerCase().includes(person)));
      const projectId = str(args, "project_id", false);
      if (projectId) rows = rows.filter((t) => t.projectId === projectId);
      return filterTasks(rows, args).slice(0, limitOf(args)).map(overviewForAi);
    },
  },
  {
    name: "get_task",
    title: "Détail d'une tâche",
    description: "Fiche complète d'une tâche : rattachement, acteurs, dates, notes, commentaires, sessions de travail, nœuds de carte liés.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" }, ...ADMIN_FLAG }, required: ["task_id"] },
    run: async (user, args) => {
      const id = str(args, "task_id");
      if (!wantsAdmin(user, args)) {
        // Périmètre normal : mes tâches accessibles et celles de mes N-1.
        const reports = await reportIdsOf(user.id);
        const ok = await prisma.task.findFirst({ where: { id, OR: [taskAccessWhere(user.id), ...(reports.length ? [tasksOfUsersWhere(reports)] : [])] }, select: { id: true } });
        if (!ok) throw new ApiError(404, "NOT_FOUND", isAdmin(user) ? "Tâche hors de votre périmètre (relancer avec admin_access: true si l'utilisateur le demande)." : "Tâche introuvable.");
      }
      const t = await getTaskDetail(user.id, id);
      return {
        id: t.id,
        name: t.name,
        project: t.project?.name ?? null,
        stage: t.stage?.name ?? null,
        activity: t.activity?.name ?? null,
        status: t.status,
        priority: t.priority,
        complexity: t.complexity,
        progress: t.progress,
        startDate: t.startDate,
        dueDate: t.dueDate,
        closedAt: t.closedAt,
        assignee: t.assignee?.name ?? null,
        supervisor: t.supervisor?.name ?? null,
        contributors: t.contributors.map((c) => c.name),
        description: t.description || undefined,
        notes: text(t.notes) || undefined,
        comments: t.comments.map((c) => ({ author: c.authorName, date: c.createdAt, text: c.body, replies: (c as { replies?: { authorName: string; createdAt: string; body: string }[] }).replies?.map((r) => ({ author: r.authorName, date: r.createdAt, text: r.body })) })),
        workSessions: t.workSessions.map((s) => ({ date: s.date, user: s.userName })),
        mindMapNodes: t.nodes,
      };
    },
  },
  {
    name: "list_mind_maps",
    title: "Lister les cartes mentales",
    description: "Mes cartes mentales (titre, nombre de nœuds, dates).",
    inputSchema: { type: "object", properties: {} },
    run: async (user) => listMindMaps(user.id),
  },
  {
    name: "get_mind_map",
    title: "Contenu d'une carte mentale",
    description: "Carte mentale sous forme d'arbre : titre, statut (OPEN, WATCH = à surveiller, CLOSED), notes de chaque nœud, nombre de tâches liées.",
    inputSchema: { type: "object", properties: { map_id: { type: "string" }, include_closed: { type: "boolean", description: "Inclure les nœuds fermés (non par défaut)." } }, required: ["map_id"] },
    run: async (user, args) => {
      const map = await getMindMap(user.id, str(args, "map_id"));
      const byParent = new Map<string | null, typeof map.nodes>();
      for (const n of map.nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
      type Out = { id: string; title: string; status: string; notes?: string; tasks?: number; openTasks?: number; children?: Out[] };
      const build = (id: string, depth: number): Out | null => {
        const n = map.nodes.find((x) => x.id === id);
        if (!n || depth > 30) return null;
        if (n.status === "CLOSED" && args.include_closed !== true && n.id !== map.rootId) return null;
        const kids = (byParent.get(n.id) ?? []).sort((a, b) => a.order - b.order).map((c) => build(c.id, depth + 1)).filter((c): c is Out => !!c);
        return { id: n.id, title: n.title, status: n.status, notes: text(n.notes, 3000) || undefined, tasks: n.taskCount || undefined, openTasks: n.openTaskCount || undefined, children: kids.length ? kids : undefined };
      };
      return { id: map.id, title: map.title, updatedAt: map.updatedAt, tree: build(map.rootId, 0) };
    },
  },
  {
    name: "browse_notes",
    title: "Parcourir la prise de notes",
    description:
      "Arborescence « Prise de notes » chargée niveau par niveau. ref = « root » (défaut), puis les ref renvoyées (section:projects, project:<id>, stage:<id>, mindmap:<id>, node:<id>, task:<id>…). hasNotes indique un document non vide.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } } },
    run: async (user, args) => noteChildren(user.id, str(args, "ref", false) || "root"),
  },
  {
    name: "read_note",
    title: "Lire des notes",
    description: "Texte des notes d'un objet (ref de browse_notes ou de search : project:<id>, stage:<id>, activity:<id>, task:<id>, mindmap:<id>, node:<id>).",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    run: async (user, args) => {
      const d = await getDocument(user.id, str(args, "ref"));
      return { ref: d.ref, title: d.title, path: d.breadcrumb.map((b) => b.title).join(" › "), updatedAt: d.updatedAt, text: text(d.notes, 50_000) };
    },
  },
  {
    name: "search",
    title: "Rechercher",
    description: "Recherche plein texte dans mes projets, tâches, cartes mentales et nœuds (titres et contenus).",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (user, args) => search(user.id, str(args, "query")),
  },
  {
    name: "list_users",
    title: "Utilisateurs (administration)",
    description: "Administrateurs uniquement : comptes de la plateforme (nom, e-mail, rôle, manager), pour cibler une analyse.",
    inputSchema: { type: "object", properties: {} },
    adminOnly: true,
    run: async (user) => (await listUsersAdmin(user)).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, manager: (u as { managerName?: string | null }).managerName ?? null })),
  },
];

export function toolsFor(user: User, canWrite = false) {
  const read = TOOLS.filter((t) => !t.adminOnly || isAdmin(user)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }));
  if (!canWrite) return read;
  return [
    ...read,
    ...WRITE_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.name === "api_reference", destructiveHint: !!t.destructive, openWorldHint: false },
    })),
  ];
}

// --- JSON-RPC ---------------------------------------------------------------------------------------

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const rpcError = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Traite un message JSON-RPC ; null pour une notification (pas de réponse). */
export async function handleRpc(user: User, msg: RpcRequest, canWrite = false): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Requête JSON-RPC invalide.");
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const id = msg.id as string | number;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS } };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: toolsFor(user, canWrite) } };
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool: { run: (user: User, args: Record<string, unknown>) => Promise<unknown> } | undefined =
        TOOLS.find((t) => t.name === name && (!t.adminOnly || isAdmin(user))) ?? (canWrite ? WRITE_TOOLS.find((t) => t.name === name) : undefined);
      if (!tool) {
        if (!canWrite && WRITE_TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, "Cette clé d'accès est en lecture seule (Préférences → Connecteur Claude).");
        return rpcError(id, -32602, `Outil inconnu : ${name}`);
      }
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      try {
        const result = await tool.run(user, args);
        const json = JSON.stringify(result, null, 1);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: json.length > 400_000 ? json.slice(0, 400_000) + "\n…(tronqué)" : json }], isError: false } };
      } catch (e) {
        // Erreur métier (accès refusé, introuvable…) : renvoyée à l'IA comme résultat d'outil en erreur.
        const message = e instanceof ApiError ? e.message : "Erreur interne.";
        if (!(e instanceof ApiError)) console.error("[mcp]", e);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } };
      }
    }
    default:
      return rpcError(id, -32601, `Méthode non prise en charge : ${msg.method}`);
  }
}
