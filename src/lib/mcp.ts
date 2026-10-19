import "server-only";
import type { Prisma, TaskStatus, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { isAdmin } from "@/lib/roles";
import { htmlToText } from "@/lib/sanitize";
import { getProject, getProjectAdmin, listAllProjectsAdmin, listProjects, projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { getMyTasks, getTaskDetail, listAllTasksAdmin, listTeamTasks, tasksOfUsersWhere, type OverviewTask } from "@/lib/tasks";
import { getMindMap, listMindMaps } from "@/lib/mindmaps";
import { children as noteChildren, getDocument } from "@/lib/notes";
import { getDashboard } from "@/lib/dashboard";
import { search } from "@/lib/search";
import { listUsersAdmin, reportIdsOf } from "@/lib/users";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import { WRITE_TOOLS } from "@/lib/mcp-write";
import { getActivity } from "@/lib/activity";
import { listTemplates } from "@/lib/templates";
import { allCustomFields, listCustomFields } from "@/lib/custom-fields";
import { customEntries, type CustomFieldDto } from "@/lib/shared/custom-fields";
import { listMapEvents } from "@/lib/map-events";
import { meetingStatus } from "@/lib/meetings";
import { QUERY_ENTITIES, queryObjects, type QueryArgs } from "@/lib/mcp-query";
import { ACTIVITY_PRESETS, addDays, parisYmd } from "@/lib/shared/activity-period";
import { getJournalReport, listJournalEntries } from "@/lib/journal";
import { JOURNAL_BLOCKS, JOURNAL_BLOCK_LABEL, formatJournalDay, isWrittenBlock, resolveJournalBlock, type JournalBlockKey, type JournalWrittenBlock } from "@/lib/shared/journal";

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
  "Pour toute question « derniers / récents / créés par / modifiés depuis » sur n'importe quel objet (tâches, comptes-rendus, commentaires, risques, documents, nœuds, messages…), utilisez query_objects (createdAt / updatedAt sur chaque objet). " +
  "Récent : list_recent_tasks (dernières tâches créées / modifiées / clôturées), list_meetings (dernières réunions avec leurs comptes-rendus), get_meeting. " +
  "Pour « que s'est-il passé » sur une période (jour, semaine, mois, dates libres), utilisez get_activity : un seul appel consolide tâches, cartes mentales, réunions, risques, livrables et documents ; rédigez ensuite la synthèse. get_map_history donne l'historique détaillé d'une carte. " +
  "Journal quotidien (personnel) : get_journal lit les saisies (résumé, pensées positives / négatives, réalisations, regrets, habitudes, amélioration continue) et l'activité du jour sur une période — pour « résume mes pensées négatives depuis 2 semaines », appelez-le avec block et from puis rédigez la synthèse ; write_journal consigne un texte dans un bloc (ajout à la suite par défaut, aujourd'hui par défaut). " +
  "Écriture (clé autorisée) : create_task, write_journal, update_task, bulk_update_tasks (ex. assigner toutes les tâches d'un projet), delete_task, add_comment, create_project, update_project, create_stage, save_note, create_meeting, update_meeting (compte-rendu), decide_meeting, upsert_risk, edit_mind_map, send_message ; " +
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
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Champs personnalisés lisibles : { « Client » : « ACME » }. */
function customForAi(fields: CustomFieldDto[], values: Record<string, string>) {
  const entries = customEntries(fields, values);
  return entries.length ? Object.fromEntries(entries.map((e) => [e.label, e.value])) : undefined;
}

function projectForAi(p: ProjectDto & { ownerName?: string }, fields: CustomFieldDto[] = []) {
  const m = p.members;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    customFields: customForAi(fields, p.customFields),
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

/** Libellés des statuts de compte-rendu et de décision (lecture par Claude). */
const MEETING_STATUS_FR: Record<string, string> = { draft: "brouillon (compte-rendu vide)", no_review: "sans validation demandée", pending: "en attente de validation", approved: "validé", rejected: "refusé" };
const DECISION_FR: Record<string, string> = { PENDING: "en attente", APPROVED: "validé", REJECTED: "refusé" };


const MEETING_AI_INCLUDE = {
  project: { select: { id: true, name: true } },
  author: { select: { name: true } },
  participants: { include: { member: { select: { name: true } } } },
  approvers: { include: { member: { select: { name: true } } } },
} satisfies Prisma.MeetingInclude;
type MeetingAiRow = Prisma.MeetingGetPayload<{ include: typeof MEETING_AI_INCLUDE }>;

function meetingForAi(m: MeetingAiRow, withMinutes: boolean, maxChars = 6000) {
  return {
    id: m.id,
    title: m.title,
    project: { id: m.project.id, name: m.project.name },
    date: m.date.toISOString(),
    location: m.location || undefined,
    author: m.author?.name ?? undefined,
    participants: m.participants.map((p) => p.member.name),
    status: MEETING_STATUS_FR[meetingStatus(m)],
    approvers: m.approvers.map((a) => ({ name: a.member.name, decision: DECISION_FR[a.decision] ?? a.decision, comment: a.comment || undefined, decidedAt: a.decidedAt?.toISOString() })),
    minutesUpdatedAt: m.minutesUpdatedAt?.toISOString(),
    ...(withMinutes ? { minutes: text(m.minutes, maxChars) } : {}),
  };
}

/** Blocs demandés (clés ou libellés) ; null = tous. */
function journalBlocksArg(args: Record<string, unknown>): JournalBlockKey[] | null {
  const raw = Array.isArray(args.blocks) ? args.blocks : typeof args.block === "string" ? [args.block] : typeof args.blocks === "string" ? String(args.blocks).split(",") : [];
  if (!raw.length) return null;
  return raw.map((r) => {
    const b = resolveJournalBlock(String(r));
    if (!b) throw new ApiError(400, "BAD_REQUEST", `Bloc inconnu : « ${String(r)} ». Blocs : ${JOURNAL_BLOCKS.map((k) => `${k} (${JOURNAL_BLOCK_LABEL[k]})`).join(", ")}.`);
    return b;
  });
}

export const TOOLS: Tool[] = [
  {
    name: "get_journal",
    title: "Journal quotidien (lecture)",
    description:
      "Mon journal quotidien sur une période : pour chaque jour renseigné, le texte de chaque bloc — " +
      JOURNAL_BLOCKS.map((b) => `${b} = « ${JOURNAL_BLOCK_LABEL[b]} »`).join(", ") +
      ". block / blocks : limiter à certains blocs (clé ou libellé, ex. « pensées négatives »). from / to : AAAA-MM-JJ inclus (heure de Paris ; défaut : 7 derniers jours ; day = un seul jour ; 366 jours au plus). " +
      "ACTIVITY (ou with_activity) ajoute les actions du jour issues des pistes d'audit (tâches, cartes). Chaque saisie porte createdAt / updatedAt. Strictement personnel.",
    inputSchema: {
      type: "object",
      properties: {
        day: { type: "string", description: "Un seul jour (AAAA-MM-JJ)." },
        from: { type: "string", description: "Début inclus (AAAA-MM-JJ)." },
        to: { type: "string", description: "Fin incluse (AAAA-MM-JJ), aujourd'hui par défaut." },
        block: { type: "string", description: "Un bloc (clé ou libellé)." },
        blocks: { type: "array", items: { type: "string" }, description: "Plusieurs blocs (clés ou libellés)." },
        with_activity: { type: "boolean", description: "Ajouter l'activité (pistes d'audit) de chaque jour." },
      },
    },
    run: async (user, args) => {
      const today = parisYmd();
      const day = str(args, "day", false);
      const to = day || str(args, "to", false) || today;
      const from = day || str(args, "from", false) || addDays(to, -6);
      const wanted = journalBlocksArg(args);
      const written = (wanted ?? JOURNAL_BLOCKS).filter(isWrittenBlock) as JournalWrittenBlock[];
      const withActivity = args.with_activity === true || !!wanted?.includes("ACTIVITY");
      const [entries, activity] = await Promise.all([
        written.length ? listJournalEntries(user.id, from, to, written) : Promise.resolve([]),
        withActivity ? getJournalReport(user.id, "ACTIVITY", from, to) : Promise.resolve(null),
      ]);
      const days = new Map<string, { day: string; label: string; blocks: Record<string, { text: string; createdAt: string; updatedAt: string }>; activity?: string[] }>();
      const at = (d: string) => days.get(d) ?? days.set(d, { day: d, label: formatJournalDay(d), blocks: {} }).get(d)!;
      for (const e of entries) at(e.day).blocks[JOURNAL_BLOCK_LABEL[e.block]] = { text: text(e.content, 50_000), createdAt: e.createdAt, updatedAt: e.updatedAt };
      for (const d of activity?.activityDays ?? []) at(d.day).activity = d.items.map((i) => `${new Date(i.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} · ${i.objectName}${i.context ? ` (${i.context})` : ""} : ${i.message}`);
      return {
        today,
        from,
        to,
        blocks: (wanted ?? JOURNAL_BLOCKS).map((b) => JOURNAL_BLOCK_LABEL[b]),
        days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
        empty: days.size === 0 ? "Aucune saisie sur la période." : undefined,
      };
    },
  },
  {
    name: "query_objects",
    title: "Rechercher n'importe quel objet (filtres, tri par date)",
    description:
      "Requête souple sur tous les objets de mon périmètre, avec leur date de création (createdAt) et de modification (updatedAt), triés du plus récent au plus ancien (sort = created par défaut, ou updated ; order asc pour l'inverse). " +
      "entity : project, stage, activity, task, comment, meeting (réunion et son compte-rendu), risk (risques et opportunités), deliverable, document, folder, mind_map, node, conversation, message, notification. " +
      "Filtres : author (« me » / « moi » ou un nom : créateur de la tâche ou du projet, rédacteur du compte-rendu, auteur du commentaire ou du message, déposant du document, propriétaire de la carte), assignee (« me » ou un nom : responsable de tâche, de livrable ou de risque), project_id, map_id, task_id, status (ex. task : open, TODO, IN_PROGRESS, DONE, CLOSED ; meeting : draft, no_review, pending, approved, rejected ; notification : read, unread), text (contient), created_after / created_before / updated_after / updated_before (AAAA-MM-JJ ou ISO), limit (20 par défaut, 200 max), with_content (texte complet des notes, comptes-rendus, messages ; sinon extrait). " +
      "Exemples : « mes 3 derniers comptes-rendus » → { entity: \"meeting\", author: \"me\", limit: 3, with_content: true } ; « les 10 dernières tâches créées » → { entity: \"task\", limit: 10 } ; « commentaires d'Alice cette semaine » → { entity: \"comment\", author: \"Alice\", created_after: \"AAAA-MM-JJ\" }. Avec admin_access (administrateur) : toute la plateforme (sauf conversations, messages et notifications, toujours personnels).",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: [...QUERY_ENTITIES] },
        author: { type: "string" },
        assignee: { type: "string" },
        project_id: { type: "string" },
        map_id: { type: "string" },
        task_id: { type: "string" },
        status: { type: "string" },
        text: { type: "string" },
        created_after: { type: "string" },
        created_before: { type: "string" },
        updated_after: { type: "string" },
        updated_before: { type: "string" },
        sort: { type: "string", enum: ["created", "updated"] },
        order: { type: "string", enum: ["desc", "asc"] },
        limit: { type: "number", minimum: 1, maximum: 200 },
        with_content: { type: "boolean" },
        ...ADMIN_FLAG,
      },
      required: ["entity"],
    },
    run: async (user, args) => queryObjects(user, { ...(args as unknown as QueryArgs), all: wantsAdmin(user, args) }),
  },
  {
    name: "list_recent_tasks",
    title: "Dernières tâches (créées, modifiées, terminées)",
    description:
      "Les N tâches les plus récentes de mon périmètre (tous projets, et mes tâches sans projet), triées par date : sort = « created » (dernières créées, défaut), « updated » (dernières modifiées) ou « closed » (dernières clôturées). Filtres : project_id, status. Avec admin_access (administrateur) : toute la plateforme. Ex. « les 10 dernières tâches créées » → { limit: 10 }.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["created", "updated", "closed"] },
        limit: { type: "number", minimum: 1, maximum: 200, description: "10 par défaut." },
        project_id: { type: "string" },
        status: { type: "string", enum: ["open", "TODO", "IN_PROGRESS", "DONE", "CLOSED"] },
        ...ADMIN_FLAG,
      },
    },
    run: async (user, args) => {
      const sort = str(args, "sort", false) || "created";
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 10;
      const status = str(args, "status", false);
      const projectId = str(args, "project_id", false);
      const where: Prisma.TaskWhereInput = {
        AND: [
          wantsAdmin(user, args) ? { OR: [{ project: { isTemplate: false } }, { projectId: null }] } : taskAccessWhere(user.id),
          projectId ? { projectId } : {},
          status === "open" ? { status: { in: ["TODO", "IN_PROGRESS"] } } : status ? { status: status as TaskStatus } : {},
          sort === "closed" ? { closedAt: { not: null } } : {},
        ],
      };
      const rows = await prisma.task.findMany({
        where,
        orderBy: sort === "updated" ? { updatedAt: "desc" } : sort === "closed" ? { closedAt: "desc" } : { createdAt: "desc" },
        take: limit,
        include: { project: { select: { id: true, name: true } }, stage: { select: { name: true } }, owner: { select: { name: true } }, assignee: { select: { name: true } } },
      });
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
        stage: t.stage?.name ?? undefined,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee?.name ?? undefined,
        createdBy: t.owner.name,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        dueDate: t.dueDate?.toISOString(),
        closedAt: t.closedAt?.toISOString(),
      }));
    },
  },
  {
    name: "list_meetings",
    title: "Réunions et comptes-rendus",
    description:
      "Réunions de mes projets (ou d'un projet : project_id), les plus récentes d'abord : titre, projet, date, rédacteur, participants, statut de validation et décisions des validateurs, et le texte du compte-rendu (with_minutes, vrai par défaut ; 6 000 caractères au plus chacun — get_meeting pour l'intégralité). Ex. « les 3 derniers comptes-rendus » → { limit: 3 }. Avec admin_access (administrateur) : toute la plateforme.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, description: "5 par défaut." },
        with_minutes: { type: "boolean" },
        status: { type: "string", enum: ["draft", "no_review", "pending", "approved", "rejected"], description: "Filtre sur le statut : draft (compte-rendu vide), no_review (sans validateur), pending, approved, rejected." },
        past_only: { type: "boolean", description: "Seulement les réunions déjà tenues (date passée)." },
        ...ADMIN_FLAG,
      },
    },
    run: async (user, args) => {
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 5;
      const projectId = str(args, "project_id", false);
      const wanted = str(args, "status", false);
      const rows = await prisma.meeting.findMany({
        where: {
          project: wantsAdmin(user, args) ? { isTemplate: false } : projectAccessWhere(user.id),
          ...(projectId ? { projectId } : {}),
          ...(args.past_only === true ? { date: { lte: new Date() } } : {}),
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: wanted ? 500 : limit,
        include: MEETING_AI_INCLUDE,
      });
      const filtered = wanted ? rows.filter((m) => meetingStatus(m) === wanted).slice(0, limit) : rows;
      return filtered.map((m) => meetingForAi(m, args.with_minutes !== false));
    },
  },
  {
    name: "get_meeting",
    title: "Compte-rendu de réunion (intégral)",
    description: "Une réunion et l'intégralité de son compte-rendu (texte), avec participants et décisions des validateurs.",
    inputSchema: { type: "object", properties: { meeting_id: { type: "string" }, ...ADMIN_FLAG }, required: ["meeting_id"] },
    run: async (user, args) => {
      const m = await prisma.meeting.findFirst({
        where: { id: str(args, "meeting_id"), project: wantsAdmin(user, args) ? { isTemplate: false } : projectAccessWhere(user.id) },
        include: MEETING_AI_INCLUDE,
      });
      if (!m) throw new ApiError(404, "NOT_FOUND", "Réunion introuvable.");
      return meetingForAi(m, true, 200_000);
    },
  },
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
    name: "list_templates",
    title: "Modèles de projets et de cartes",
    description: "Projets types et cartes types définis dans l'administration (nom, contenu) : utilisables par create_project (template) et edit_mind_map create_map (template).",
    inputSchema: { type: "object", properties: {} },
    run: async () => listTemplates(),
  },
  {
    name: "list_custom_fields",
    title: "Champs personnalisés des projets",
    description: "Champs personnalisés définis dans l'administration (ex. « Client ») : libellé, type (TEXT texte libre, LIST liste de valeurs) et valeurs possibles.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await listCustomFields()).map((f) => ({ id: f.id, label: f.label, type: f.type, values: f.type === "LIST" ? f.options.map((o) => o.label) : undefined })),
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
        custom_field: { type: "string", description: "Filtre sur un champ personnalisé, « Libellé=valeur » (ex. « Client=ACME »)." },
        ...ADMIN_FLAG,
      },
    },
    run: async (user, args) => {
      const admin = wantsAdmin(user, args);
      let rows: Array<{ id: string; name: string; status: string; description: string; startDate: string | null; dueDate: string | null; progress: unknown; stageCount: number; memberCount: number; deliverableCount: number; updatedAt: string; ownerName?: string; ownerId: string; customFields: Record<string, string> }> = admin
        ? await listAllProjectsAdmin(user)
        : await listProjects(user.id);
      if (typeof args.status === "string") rows = rows.filter((p) => p.status === args.status);
      const q = str(args, "query", false).toLowerCase();
      if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
      const fields = await allCustomFields();
      // Filtre sur un champ personnalisé : « Client=ACME ».
      const cf = str(args, "custom_field", false);
      if (cf.includes("=")) {
        const [label, wanted] = cf.split("=").map((x) => x.trim().toLowerCase());
        rows = rows.filter((p) => customEntries(fields, p.customFields).some((e) => e.label.toLowerCase() === label && e.value.toLowerCase() === wanted));
      }
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        customFields: customForAi(fields, p.customFields),
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
      return projectForAi(p, await allCustomFields());
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
      const meta = await prisma.task.findUnique({ where: { id }, select: { createdAt: true, owner: { select: { name: true } } } });
      return {
        id: t.id,
        name: t.name,
        createdBy: meta?.owner.name,
        createdAt: meta?.createdAt.toISOString(),
        updatedAt: t.updatedAt,
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
