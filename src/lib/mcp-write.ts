import "server-only";
import { listTemplates } from "@/lib/templates";
import { allCustomFields } from "@/lib/custom-fields";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { hashSessionToken } from "@/lib/auth";
import { getProject, type ProjectDto, type TaskDto } from "@/lib/projects";
import { JOURNAL_BLOCK_LABEL, JOURNAL_WRITTEN_BLOCKS, resolveJournalBlock } from "@/lib/shared/journal";
import { parisYmd } from "@/lib/shared/activity-period";
import { listContacts } from "@/lib/messages";

/**
 * Outils MCP d'écriture (clés « lecture et écriture »).
 *
 * Toutes les écritures passent par l'API REST /api/v1 elle-même, en boucle
 * locale, avec une session éphémère de l'utilisateur de la clé : mêmes
 * validations zod, mêmes droits (anti-IDOR), mêmes limites, même piste
 * d'audit et mêmes notifications que l'interface. Rien n'est contourné.
 *
 *  - outils « métier » ergonomiques (noms de personnes / de tâches acceptés) ;
 *  - `api_request` : n'importe quelle route de l'API (tout le reste) ;
 *  - `api_reference` : la documentation de l'API pour savoir quoi appeler.
 */

export type WriteTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  destructive?: boolean;
  run: (user: User, args: Record<string, unknown>) => Promise<unknown>;
};

// --- Appel de l'API en boucle locale ------------------------------------------------------------

const INTERNAL_BASE = () => (process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/** Routes jamais accessibles par le connecteur (identité, clés, synchro, le connecteur lui-même). */
const FORBIDDEN = [/^\/mcp(\/|$)/, /^\/auth(\/|$)/, /^\/me\/api-keys/, /^\/me\/password/, /^\/me\/email/, /^\/me\/calendar/, /^\/calendar(\/|$)/, /^\/sync(\/|$)/];

export async function callApi<T = Record<string, unknown>>(user: User, method: string, apiPath: string, body?: unknown): Promise<T> {
  const m = method.toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(m)) throw new ApiError(400, "BAD_ARGUMENT", "Méthode non autorisée.");
  const p = apiPath.trim().replace(/^\/api\/v1/, "");
  if (!p.startsWith("/") || p.includes("..") || p.includes("\\") || p.length > 500) throw new ApiError(400, "BAD_ARGUMENT", "Chemin d'API invalide (ex. « /projects/<id> »).");
  if (FORBIDDEN.some((re) => re.test(p))) throw new ApiError(403, "FORBIDDEN", "Cette route n'est pas accessible depuis le connecteur.");

  // Session éphémère (2 min), supprimée après l'appel.
  const token = randomBytes(32).toString("hex");
  const session = await prisma.session.create({
    data: { token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + 120_000), label: "Connecteur MCP (temporaire)" },
    select: { id: true },
  });
  try {
    const res = await fetch(`${INTERNAL_BASE()}/api/v1${p}`, {
      method: m,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined && m !== "GET" ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      if (res.ok) return { status: res.status, note: `Réponse non JSON (${type || "vide"}) : fichier binaire non renvoyé par le connecteur.` } as T;
      throw new ApiError(res.status, "API_ERROR", `Erreur ${res.status}.`);
    }
    const data = (await res.json()) as T & { error?: { message?: string; details?: unknown } };
    if (!res.ok) {
      const details = data.error?.details ? ` Détails : ${JSON.stringify(data.error.details).slice(0, 800)}` : "";
      throw new ApiError(res.status, "API_ERROR", `${data.error?.message ?? `Erreur ${res.status}`}${details}`);
    }
    return data;
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  }
}

// --- Aides --------------------------------------------------------------------------------------

const s = (args: Record<string, unknown>, k: string, required = false): string | undefined => {
  const v = args[k];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (required) throw new ApiError(400, "BAD_ARGUMENT", `Paramètre « ${k} » requis.`);
  return undefined;
};
const has = (args: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(args, k);

function escapeHtml(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Texte brut → HTML (paragraphes séparés par une ligne vide, retours à la ligne conservés). */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
/** Contenu riche : `html` tel quel (assaini par le serveur) ou `text` converti. */
function richContent(args: Record<string, unknown>, htmlKey = "html", textKey = "text"): string | undefined {
  const html = typeof args[htmlKey] === "string" ? (args[htmlKey] as string) : undefined;
  if (html !== undefined) return html;
  const text = typeof args[textKey] === "string" ? (args[textKey] as string) : undefined;
  return text !== undefined ? textToHtml(text) : undefined;
}

function allTasks(p: ProjectDto): TaskDto[] {
  return [...p.tasks, ...p.stages.flatMap((st) => [...st.tasks, ...st.activities.flatMap((a) => a.tasks)])];
}

/** Membre du projet par identifiant, e-mail ou nom (insensible à la casse ; doit être unique). */
function resolveMember(project: ProjectDto, ref: string | null | undefined): string | null | undefined {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "" || /^(none|personne|aucun)$/i.test(ref)) return null;
  const q = ref.trim().toLowerCase();
  const byId = project.members.find((m) => m.id === ref);
  if (byId) return byId.id;
  const exact = project.members.filter((m) => m.email?.toLowerCase() === q || m.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0].id;
  const partial = project.members.filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0].id;
  const list = project.members.map((m) => `${m.name}${m.email ? ` <${m.email}>` : ""}`).join(", ");
  throw new ApiError(400, "BAD_ARGUMENT", partial.length > 1 ? `« ${ref} » est ambigu dans le projet : ${partial.map((m) => m.name).join(", ")}.` : `« ${ref} » n'est pas membre du projet. Membres : ${list || "aucun"}.`);
}

/** Tâche du projet par identifiant ou nom exact (insensible à la casse). */
function resolveTask(project: ProjectDto, ref: string): string {
  const tasks = allTasks(project);
  const byId = tasks.find((t) => t.id === ref);
  if (byId) return byId.id;
  const byName = tasks.filter((t) => t.name.toLowerCase() === ref.trim().toLowerCase());
  if (byName.length === 1) return byName[0].id;
  throw new ApiError(400, "BAD_ARGUMENT", byName.length > 1 ? `Plusieurs tâches s'appellent « ${ref} » : utilisez leur identifiant.` : `Tâche « ${ref} » introuvable dans le projet.`);
}

async function projectOfTask(user: User, taskId: string): Promise<ProjectDto | null> {
  const r = await callApi<{ task: { project: { id: string } | null } }>(user, "GET", `/tasks/${encodeURIComponent(taskId)}`);
  return r.task.project ? getProject(user.id, r.task.project.id) : null;
}

/** Champs de tâche « ergonomiques » → corps de l'API (personnes et prérequis résolus). */
function taskBody(args: Record<string, unknown>, project: ProjectDto | null): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const map: Array<[string, string]> = [
    ["name", "name"],
    ["description", "description"],
    ["status", "status"],
    ["priority", "priority"],
    ["complexity", "complexity"],
    ["start_date", "startDate"],
    ["due_date", "dueDate"],
    ["closed_at", "closedAt"],
  ];
  for (const [from, to] of map) if (has(args, from)) b[to] = args[from] === "" ? null : args[from];
  if (has(args, "progress")) b.progress = Number(args.progress);
  const needProject = ["assignee", "supervisor", "contributors", "prerequisites"].filter((k) => has(args, k));
  if (needProject.length && !project) throw new ApiError(400, "BAD_ARGUMENT", "Personnes et prérequis ne s'appliquent qu'à une tâche rattachée à un projet.");
  if (project) {
    if (has(args, "assignee")) b.assigneeId = resolveMember(project, args.assignee as string | null);
    if (has(args, "supervisor")) b.supervisorId = resolveMember(project, args.supervisor as string | null);
    if (has(args, "contributors")) b.contributorIds = ((args.contributors as string[]) ?? []).map((r) => resolveMember(project, r)).filter(Boolean);
    if (has(args, "prerequisites")) b.prerequisiteIds = ((args.prerequisites as string[]) ?? []).map((r) => resolveTask(project, r));
  }
  for (const k of ["stage_id", "activity_id", "project_id"]) if (has(args, k)) b[k.replace(/_id$/, "Id")] = args[k] || null;
  return b;
}

const TASK_FIELDS = {
  name: { type: "string" },
  description: { type: "string" },
  status: { type: "string", enum: ["TODO", "IN_PROGRESS", "DONE", "CLOSED"] },
  progress: { type: "number", minimum: 0, maximum: 100 },
  priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  complexity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
  start_date: { type: ["string", "null"], description: "AAAA-MM-JJ, ou null pour effacer" },
  due_date: { type: ["string", "null"], description: "AAAA-MM-JJ, ou null pour effacer" },
  assignee: { type: ["string", "null"], description: "Responsable : nom, e-mail ou id de membre du projet ; null = personne" },
  supervisor: { type: ["string", "null"], description: "Superviseur : nom, e-mail ou id de membre ; null = personne" },
  contributors: { type: "array", items: { type: "string" }, description: "Contributeurs (remplace la liste) : noms, e-mails ou ids" },
  prerequisites: { type: "array", items: { type: "string" }, description: "Prérequis (remplace la liste) : ids ou noms exacts de tâches du projet" },
};

// --- Outils ---------------------------------------------------------------------------------------

/** Modèle désigné par nom (insensible à la casse) ou id ; erreur claire sinon. */
async function templateIdOf(kind: "project" | "map", ref: string | undefined | null): Promise<string | null> {
  if (!ref) return null;
  const t = await listTemplates();
  const list = kind === "project" ? t.projects.map((p) => ({ id: p.id, name: p.name })) : t.maps.map((m) => ({ id: m.id, name: m.title }));
  const hit = list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new ApiError(400, "BAD_ARGUMENT", `Modèle inconnu : « ${ref} » (${list.map((x) => x.name).join(", ") || "aucun modèle"}).`);
  return hit.id;
}

export const WRITE_TOOLS: WriteTool[] = [
  {
    name: "write_journal",
    title: "Écrire dans mon journal quotidien",
    description:
      "Consigne un texte dans un bloc de mon journal quotidien : " +
      JOURNAL_WRITTEN_BLOCKS.map((b) => `${b} = « ${JOURNAL_BLOCK_LABEL[b]} »`).join(", ") +
      " (block : clé ou libellé, ex. « pensées positives »). day : AAAA-MM-JJ (aujourd'hui par défaut, heure de Paris). mode : append (défaut, ajoute à la suite de la saisie existante) ou replace (remplace ; texte vide = effacer). text (texte brut) ou html.",
    inputSchema: {
      type: "object",
      properties: {
        block: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        day: { type: "string" },
        mode: { type: "string", enum: ["append", "replace"] },
      },
      required: ["block"],
    },
    run: async (user, args) => {
      const block = resolveJournalBlock(s(args, "block", true)!);
      if (!block || block === "ACTIVITY") throw new ApiError(400, "BAD_REQUEST", block === "ACTIVITY" ? "Le bloc « Activité » est calculé automatiquement : choisissez un autre bloc." : `Bloc inconnu. Blocs : ${JOURNAL_WRITTEN_BLOCKS.map((b) => JOURNAL_BLOCK_LABEL[b]).join(", ")}.`);
      const day = s(args, "day") ?? parisYmd();
      const mode = s(args, "mode") === "replace" ? "replace" : "append";
      const html = typeof args.html === "string" ? args.html : undefined;
      const r = await callApi<{ entry: { day: string; updatedAt: string } | null }>(user, "PUT", `/journal/days/${encodeURIComponent(day)}/blocks/${block}`, html !== undefined ? { content: html, mode } : { text: s(args, "text") ?? "", mode });
      return { ok: true, day, block: JOURNAL_BLOCK_LABEL[block], mode, saved: r.entry ? "enregistré" : "bloc vide (saisie effacée)", updatedAt: r.entry?.updatedAt };
    },
  },
  {
    name: "api_reference",
    title: "Documentation de l'API",
    description: "Documentation complète de l'API REST /api/v1 (routes, corps, réponses). Paramètre `section` facultatif (mot-clé d'un titre : « Réunions », « Risques », « Projets »…). À consulter avant d'utiliser api_request.",
    inputSchema: { type: "object", properties: { section: { type: "string" } } },
    run: async (_user, args) => {
      const file = [path.join(process.cwd(), "docs", "04-api.md"), path.join(process.cwd(), "..", "docs", "04-api.md")].find((f) => fs.existsSync(f));
      if (!file) return "Documentation indisponible sur ce serveur.";
      const doc = fs.readFileSync(file, "utf8");
      const section = s(args, "section");
      if (!section) return doc;
      const parts = doc.split(/\n(?=#{2,3} )/);
      const hits = parts.filter((p) => p.split("\n")[0].toLowerCase().includes(section.toLowerCase()));
      return hits.length ? hits.join("\n") : `Aucune section « ${section} ». Sections : ${parts.map((p) => p.split("\n")[0]).filter((h) => h.startsWith("#")).join(" | ")}`;
    },
  },
  {
    name: "api_request",
    title: "Appeler l'API (toute action)",
    description:
      "Appelle n'importe quelle route de l'API REST de Second Brain au nom de l'utilisateur (mêmes droits que dans l'application) : tout ce que l'interface permet (projets, étapes, activités, tâches, livrables, équipe, documents, dossiers, cartes et nœuds, notes, commentaires, sessions, réunions, risques, messagerie, notifications, épingles, préférences, administration si administrateur). `path` relatif à /api/v1 (ex. « /projects/abc/stages »). Consultez api_reference pour les corps attendus.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"] },
        path: { type: "string" },
        body: { type: "object", description: "Corps JSON (POST / PATCH / PUT)" },
      },
      required: ["method", "path"],
    },
    destructive: true,
    run: async (user, args) => callApi(user, s(args, "method", true)!, s(args, "path", true)!, args.body),
  },
  {
    name: "create_task",
    title: "Créer une tâche",
    description: "Crée une tâche (dans un projet, une étape, une activité, ou sans projet). Personnes et prérequis par nom, e-mail ou id.",
    inputSchema: { type: "object", properties: { project_id: { type: "string" }, stage_id: { type: "string" }, activity_id: { type: "string" }, ...TASK_FIELDS }, required: ["name"] },
    run: async (user, args) => {
      const pid = s(args, "project_id");
      const project = pid ? await getProject(user.id, pid) : null;
      const body = taskBody(args, project);
      return callApi(user, "POST", "/tasks", { ...body, projectId: pid ?? null, stageId: s(args, "stage_id") ?? null, activityId: s(args, "activity_id") ?? null });
    },
  },
  {
    name: "update_task",
    title: "Modifier une tâche",
    description: "Modifie une tâche : nom, description, statut, avancement, priorité, complexité, dates, responsable, superviseur, contributeurs, prérequis, rattachement (stage_id / activity_id / project_id ; null détache). Seuls les champs fournis changent.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" }, ...TASK_FIELDS, closed_at: { type: "string" }, stage_id: { type: ["string", "null"] }, activity_id: { type: ["string", "null"] }, project_id: { type: ["string", "null"] } }, required: ["task_id"] },
    run: async (user, args) => {
      const id = s(args, "task_id", true)!;
      const project = await projectOfTask(user, id);
      const r = await callApi<{ task: unknown }>(user, "PATCH", `/tasks/${encodeURIComponent(id)}`, taskBody(args, project));
      return { ok: true, task: r.task };
    },
  },
  {
    name: "bulk_update_tasks",
    title: "Modifier des tâches en masse",
    description:
      "Applique les mêmes changements à toutes les tâches d'un projet correspondant à un filtre (ex. assigner toutes les tâches d'un projet à quelqu'un, clôturer une étape, décaler des dates). Filtre : stage_id, activity_id, status (« open » = à faire ou en cours), assignee (nom / e-mail / « none » = sans responsable), name_contains. Changements : assignee, supervisor, status, priority, complexity, shift_days (décale début et échéance).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        filter: {
          type: "object",
          properties: { stage_id: { type: "string" }, activity_id: { type: "string" }, status: { type: "string" }, assignee: { type: "string" }, name_contains: { type: "string" } },
        },
        set: {
          type: "object",
          properties: { assignee: { type: ["string", "null"] }, supervisor: { type: ["string", "null"] }, status: { type: "string" }, priority: { type: "string" }, complexity: { type: "string" }, shift_days: { type: "number" } },
        },
        dry_run: { type: "boolean", description: "Liste les tâches visées sans rien modifier." },
      },
      required: ["project_id", "set"],
    },
    destructive: true,
    run: async (user, args) => {
      const project = await getProject(user.id, s(args, "project_id", true)!);
      const f = (args.filter ?? {}) as Record<string, string>;
      const set = (args.set ?? {}) as Record<string, unknown>;
      const assigneeFilter = f.assignee ? (/^(none|personne|aucun)$/i.test(f.assignee) ? null : resolveMember(project, f.assignee)) : undefined;
      const stageOf = new Map<string, string | null>();
      const activityOf = new Map<string, string | null>();
      for (const st of project.stages) {
        for (const t of st.tasks) stageOf.set(t.id, st.id);
        for (const a of st.activities) for (const t of a.tasks) {
          stageOf.set(t.id, st.id);
          activityOf.set(t.id, a.id);
        }
      }
      const targets = allTasks(project).filter((t) => {
        if (f.stage_id && stageOf.get(t.id) !== f.stage_id) return false;
        if (f.activity_id && activityOf.get(t.id) !== f.activity_id) return false;
        if (f.status === "open" && !(t.status === "TODO" || t.status === "IN_PROGRESS")) return false;
        if (f.status && f.status !== "open" && t.status !== f.status) return false;
        if (assigneeFilter !== undefined && t.assigneeId !== assigneeFilter) return false;
        if (f.name_contains && !t.name.toLowerCase().includes(f.name_contains.toLowerCase())) return false;
        return true;
      });
      if (targets.length > 500) throw new ApiError(400, "BAD_ARGUMENT", `${targets.length} tâches visées : affinez le filtre (500 au plus).`);
      if (args.dry_run === true) return { count: targets.length, tasks: targets.map((t) => ({ id: t.id, name: t.name, status: t.status })) };
      const base = taskBody({ ...("assignee" in set ? { assignee: set.assignee } : {}), ...("supervisor" in set ? { supervisor: set.supervisor } : {}), ...(set.status ? { status: set.status } : {}), ...(set.priority ? { priority: set.priority } : {}), ...(set.complexity ? { complexity: set.complexity } : {}) }, project);
      const shift = typeof set.shift_days === "number" ? Math.round(set.shift_days) : 0;
      const move = (d: string | null) => (d && shift ? new Date(new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime() + shift * 86_400_000).toISOString().slice(0, 10) : undefined);
      const done: string[] = [];
      const failed: Array<{ task: string; error: string }> = [];
      for (const t of targets) {
        const body = { ...base, ...(shift && t.startDate ? { startDate: move(t.startDate) } : {}), ...(shift && t.dueDate ? { dueDate: move(t.dueDate) } : {}) };
        if (Object.keys(body).length === 0) continue;
        try {
          await callApi(user, "PATCH", `/tasks/${t.id}`, body);
          done.push(t.name);
        } catch (e) {
          failed.push({ task: t.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { updated: done.length, tasks: done, failed };
    },
  },
  {
    name: "delete_task",
    title: "Supprimer une tâche",
    description: "Supprime définitivement une tâche (et ses commentaires).",
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    destructive: true,
    run: async (user, args) => callApi(user, "DELETE", `/tasks/${encodeURIComponent(s(args, "task_id", true)!)}`).then(() => ({ ok: true })),
  },
  {
    name: "add_comment",
    title: "Commenter une tâche",
    description: "Ajoute un commentaire sur une tâche (mentions « @[Nom] » possibles), éventuellement en réponse à un commentaire (reply_to).",
    inputSchema: { type: "object", properties: { task_id: { type: "string" }, text: { type: "string" }, reply_to: { type: "string" } }, required: ["task_id", "text"] },
    run: async (user, args) => {
      await callApi(user, "POST", `/tasks/${encodeURIComponent(s(args, "task_id", true)!)}/comments`, { body: s(args, "text", true), parentId: s(args, "reply_to") ?? null });
      return { ok: true };
    },
  },
  {
    name: "create_project",
    title: "Créer un projet",
    description: "Crée un projet (vous en devenez propriétaire). template : nom ou id d'un projet type (voir list_templates) pour reprendre sa structure (étapes, tâches, livrables, risques).",
    inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, start_date: { type: "string" }, due_date: { type: "string" }, template: { type: "string" } }, required: ["name"] },
    run: async (user, args) => {
      const templateId = await templateIdOf("project", s(args, "template"));
      const r = await callApi<{ project: { id: string; name: string } }>(user, "POST", "/projects", { name: s(args, "name", true), description: s(args, "description") ?? "", startDate: s(args, "start_date") ?? null, dueDate: s(args, "due_date") ?? null, ...(templateId ? { templateId } : {}) });
      return { id: r.project.id, name: r.project.name };
    },
  },
  {
    name: "update_project",
    title: "Modifier un projet",
    description: "Modifie un projet : nom, description, statut (ACTIVE, ON_HOLD, DONE, ARCHIVED), dates, notes (texte ou HTML), champs personnalisés (custom_fields : { « Libellé » : valeur } ; pour une liste, le libellé d'une valeur existante — voir list_custom_fields ; null ou \"\" pour vider).",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"] }, start_date: { type: ["string", "null"] }, due_date: { type: ["string", "null"] }, notes_text: { type: "string" }, notes_html: { type: "string" }, custom_fields: { type: "object", additionalProperties: { type: ["string", "null"] } } },
      required: ["project_id"],
    },
    run: async (user, args) => {
      const id = s(args, "project_id", true)!;
      const body: Record<string, unknown> = {};
      if (has(args, "name")) body.name = args.name;
      if (has(args, "description")) body.description = args.description;
      if (has(args, "status")) body.status = args.status;
      if (has(args, "start_date")) body.startDate = args.start_date || null;
      if (has(args, "due_date")) body.dueDate = args.due_date || null;
      if (args.custom_fields && typeof args.custom_fields === "object") {
        // Libellés (ou identifiants) de champs → identifiants ; les valeurs de liste sont acceptées par libellé.
        const fields = await allCustomFields();
        const patch: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(args.custom_fields as Record<string, unknown>)) {
          const f = fields.find((x) => x.id === k) ?? fields.find((x) => x.label.toLowerCase() === k.trim().toLowerCase());
          if (!f) throw new ApiError(400, "BAD_ARGUMENT", `Champ personnalisé inconnu : « ${k} » (${fields.map((x) => x.label).join(", ") || "aucun champ défini"}).`);
          patch[f.id] = typeof v === "string" && v.trim() ? v.trim() : null;
        }
        body.customFields = patch;
      }
      if (Object.keys(body).length) await callApi(user, "PATCH", `/projects/${encodeURIComponent(id)}`, body);
      const notes = richContent(args, "notes_html", "notes_text");
      if (notes !== undefined) await callApi(user, "PATCH", `/notes/project/${encodeURIComponent(id)}`, { notes });
      return { ok: true };
    },
  },
  {
    name: "create_stage",
    title: "Créer une étape",
    description: "Ajoute une étape à un projet (option : une activité dans une étape avec stage_id + activity_name).",
    inputSchema: { type: "object", properties: { project_id: { type: "string" }, name: { type: "string" }, start_date: { type: "string" }, due_date: { type: "string" }, stage_id: { type: "string" }, activity_name: { type: "string" } } },
    run: async (user, args) => {
      if (s(args, "stage_id") && s(args, "activity_name")) {
        await callApi(user, "POST", `/stages/${encodeURIComponent(s(args, "stage_id")!)}/activities`, { name: s(args, "activity_name") });
        return { ok: true };
      }
      await callApi(user, "POST", `/projects/${encodeURIComponent(s(args, "project_id", true)!)}/stages`, { name: s(args, "name", true), startDate: s(args, "start_date") ?? null, dueDate: s(args, "due_date") ?? null });
      return { ok: true };
    },
  },
  {
    name: "save_note",
    title: "Écrire des notes",
    description: "Écrit les notes riches d'un objet (ref « project:<id> », « stage:<id> », « activity:<id> », « task:<id> », « mindmap:<id> », « node:<id> »). mode « replace » (défaut) ou « append ». Contenu en `text` (converti) ou `html`.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" }, html: { type: "string" }, mode: { type: "string", enum: ["replace", "append"] } }, required: ["ref"] },
    run: async (user, args) => {
      const ref = s(args, "ref", true)!;
      const [kind, id] = ref.split(":");
      if (!kind || !id) throw new ApiError(400, "BAD_ARGUMENT", "ref attendue : « kind:id ».");
      const content = richContent(args) ?? "";
      let notes = content;
      if (args.mode === "append") {
        const cur = await callApi<{ document: { notes: string } }>(user, "GET", `/notes/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
        notes = (cur.document.notes || "") + content;
      }
      await callApi(user, "PATCH", `/notes/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { notes });
      return { ok: true };
    },
  },
  {
    name: "create_meeting",
    title: "Créer une réunion",
    description: "Crée une réunion dans un projet : titre, date (ISO), lieu, participants et validateurs (noms / e-mails / ids de membres), compte-rendu (texte ou HTML).",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, title: { type: "string" }, date: { type: "string" }, location: { type: "string" }, participants: { type: "array", items: { type: "string" } }, approvers: { type: "array", items: { type: "string" } }, minutes_text: { type: "string" }, minutes_html: { type: "string" } },
      required: ["project_id", "title", "date"],
    },
    run: async (user, args) => {
      const pid = s(args, "project_id", true)!;
      const project = await getProject(user.id, pid);
      const r = await callApi<{ meetings: { id: string; title: string }[] }>(user, "POST", `/projects/${encodeURIComponent(pid)}/meetings`, {
        title: s(args, "title", true),
        date: new Date(s(args, "date", true)!).toISOString(),
        location: s(args, "location") ?? "",
        participantIds: ((args.participants as string[]) ?? []).map((m) => resolveMember(project, m)),
        approverIds: ((args.approvers as string[]) ?? []).map((m) => resolveMember(project, m)),
        minutes: richContent(args, "minutes_html", "minutes_text"),
      });
      return { ok: true, meetings: r.meetings.map((m) => ({ id: m.id, title: m.title })) };
    },
  },
  {
    name: "update_meeting",
    title: "Modifier une réunion / son compte-rendu",
    description: "Modifie une réunion (titre, date, lieu, participants, validateurs) et/ou son compte-rendu : minutes_text / minutes_html (remplace) ou append_text (ajoute à la fin). Toute modification du compte-rendu remet les validations en attente.",
    inputSchema: {
      type: "object",
      properties: { meeting_id: { type: "string" }, project_id: { type: "string", description: "Requis si participants / validateurs sont donnés par nom" }, title: { type: "string" }, date: { type: "string" }, location: { type: "string" }, participants: { type: "array", items: { type: "string" } }, approvers: { type: "array", items: { type: "string" } }, minutes_text: { type: "string" }, minutes_html: { type: "string" }, append_text: { type: "string" } },
      required: ["meeting_id"],
    },
    run: async (user, args) => {
      const id = s(args, "meeting_id", true)!;
      const body: Record<string, unknown> = {};
      if (has(args, "title")) body.title = args.title;
      if (has(args, "date")) body.date = new Date(String(args.date)).toISOString();
      if (has(args, "location")) body.location = args.location;
      if (has(args, "participants") || has(args, "approvers")) {
        const project = await getProject(user.id, s(args, "project_id", true)!);
        if (has(args, "participants")) body.participantIds = (args.participants as string[]).map((m) => resolveMember(project, m));
        if (has(args, "approvers")) body.approverIds = (args.approvers as string[]).map((m) => resolveMember(project, m));
      }
      const minutes = richContent(args, "minutes_html", "minutes_text");
      if (minutes !== undefined) body.minutes = minutes;
      if (typeof args.append_text === "string") {
        const pid = s(args, "project_id") ?? (await prisma.meeting.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
        if (!pid) throw new ApiError(404, "NOT_FOUND", "Réunion introuvable.");
        const list = await callApi<{ meetings: { id: string; minutes: string }[] }>(user, "GET", `/projects/${encodeURIComponent(pid)}/meetings`);
        const cur = list.meetings.find((m) => m.id === id);
        if (!cur) throw new ApiError(404, "NOT_FOUND", "Réunion introuvable.");
        body.minutes = (cur.minutes || "") + textToHtml(args.append_text);
      }
      await callApi(user, "PATCH", `/meetings/${encodeURIComponent(id)}`, body);
      return { ok: true };
    },
  },
  {
    name: "decide_meeting",
    title: "Valider / refuser un compte-rendu",
    description: "En tant que validateur : APPROVED, ou REJECTED avec un motif.",
    inputSchema: { type: "object", properties: { meeting_id: { type: "string" }, decision: { type: "string", enum: ["APPROVED", "REJECTED"] }, comment: { type: "string" } }, required: ["meeting_id", "decision"] },
    run: async (user, args) => {
      await callApi(user, "POST", `/meetings/${encodeURIComponent(s(args, "meeting_id", true)!)}/decision`, { decision: s(args, "decision", true), comment: s(args, "comment") ?? "" });
      return { ok: true };
    },
  },
  {
    name: "upsert_risk",
    title: "Créer / modifier un risque ou une opportunité",
    description: "Sans risk_id : crée (project_id requis). Avec risk_id : modifie. Champs : kind (RISK / OPPORTUNITY), title, description, category, probability 1-5, impact 1-5, status (OPEN, MONITORING, TREATED, CLOSED), owner (nom / e-mail / id de membre), response (plan), strategy (ACCEPT = accepter et surveiller ; MITIGATE = atténuer / améliorer ; TRANSFER = transférer / partager ; ELIMINATE = éliminer / exploiter ; null pour effacer), tasks (ids ou noms : remplace les tâches liées).",
    inputSchema: {
      type: "object",
      properties: {
        risk_id: { type: "string" },
        project_id: { type: "string" },
        kind: { type: "string", enum: ["RISK", "OPPORTUNITY"] },
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        probability: { type: "number" },
        impact: { type: "number" },
        status: { type: "string", enum: ["OPEN", "MONITORING", "TREATED", "CLOSED"] },
        owner: { type: ["string", "null"] },
        response: { type: "string" },
        strategy: { type: ["string", "null"], enum: ["ACCEPT", "MITIGATE", "TRANSFER", "ELIMINATE", null] },
        tasks: { type: "array", items: { type: "string" } },
      },
    },
    run: async (user, args) => {
      const riskId = s(args, "risk_id");
      const pid = s(args, "project_id") ?? (riskId ? (await prisma.risk.findUnique({ where: { id: riskId }, select: { projectId: true } }))?.projectId : undefined);
      if (!pid) throw new ApiError(400, "BAD_ARGUMENT", "project_id requis (ou risk_id existant).");
      const project = await getProject(user.id, pid);
      const body: Record<string, unknown> = {};
      for (const k of ["kind", "title", "description", "category", "status", "response"]) if (has(args, k)) body[k] = args[k];
      for (const k of ["probability", "impact"]) if (has(args, k)) body[k] = Number(args[k]);
      if (has(args, "strategy")) body.strategy = args.strategy || null;
      if (has(args, "owner")) body.ownerId = resolveMember(project, args.owner as string | null);
      let id = riskId;
      if (!id) {
        const r = await callApi<{ risks: { id: string; createdAt: string }[] }>(user, "POST", `/projects/${encodeURIComponent(pid)}/risks`, body);
        id = [...r.risks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.id;
      } else if (Object.keys(body).length) await callApi(user, "PATCH", `/risks/${encodeURIComponent(id)}`, body);
      if (id && Array.isArray(args.tasks)) await callApi(user, "PUT", `/risks/${encodeURIComponent(id)}/tasks`, { taskIds: (args.tasks as string[]).map((t) => resolveTask(project, t)) });
      return { ok: true, risk_id: id };
    },
  },
  {
    name: "edit_mind_map",
    title: "Modifier une carte mentale",
    description:
      "Actions sur les cartes : « create_map » (title, template? : nom ou id d'une carte type), « rename_map » (map_id, title), « add_node » (map_id, parent_id, title), « update_node » (map_id, node_id, title?, status? OPEN/WATCH/CLOSED, notes_text? / notes_html?), « delete_node » (map_id, node_id). Pour les autres actions (déplacer, couleur, lier une tâche), utilisez api_request.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_map", "rename_map", "add_node", "update_node", "delete_node"] },
        template: { type: "string" },
        map_id: { type: "string" },
        node_id: { type: "string" },
        parent_id: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: ["OPEN", "WATCH", "CLOSED"] },
        notes_text: { type: "string" },
        notes_html: { type: "string" },
      },
      required: ["action"],
    },
    run: async (user, args) => {
      const action = s(args, "action", true);
      const map = s(args, "map_id");
      const enc = encodeURIComponent;
      switch (action) {
        case "create_map": {
          const templateId = await templateIdOf("map", s(args, "template"));
          if (templateId) {
            const r = await callApi<{ mindmap: { id: string; rootId: string } }>(user, "POST", "/mindmaps", { title: s(args, "title", true), templateId });
            return { ok: true, map_id: r.mindmap.id, root_node_id: r.mindmap.rootId };
          }
          const r = await callApi<{ mindmap: { id: string; rootId: string } }>(user, "POST", "/mindmaps", { title: s(args, "title", true) });
          return { ok: true, map_id: r.mindmap.id, root_node_id: r.mindmap.rootId };
        }
        case "rename_map":
          await callApi(user, "PATCH", `/mindmaps/${enc(map!)}`, { title: s(args, "title", true) });
          return { ok: true };
        case "add_node": {
          const r = await callApi<{ node: { id: string } }>(user, "POST", `/mindmaps/${enc(map!)}/nodes`, { parentId: s(args, "parent_id", true), title: s(args, "title", true) });
          return { ok: true, node_id: r.node?.id };
        }
        case "update_node": {
          const body: Record<string, unknown> = {};
          if (has(args, "title")) body.title = args.title;
          if (has(args, "status")) body.status = args.status;
          const notes = richContent(args, "notes_html", "notes_text");
          if (notes !== undefined) body.notes = notes;
          await callApi(user, "PATCH", `/mindmaps/${enc(map!)}/nodes/${enc(s(args, "node_id", true)!)}`, body);
          return { ok: true };
        }
        case "delete_node":
          await callApi(user, "DELETE", `/mindmaps/${enc(map!)}/nodes/${enc(s(args, "node_id", true)!)}`);
          return { ok: true };
        default:
          throw new ApiError(400, "BAD_ARGUMENT", "Action inconnue.");
      }
    },
  },
  {
    name: "send_message",
    title: "Envoyer un message",
    description: "Envoie un message dans la messagerie interne : à une ou plusieurs personnes (noms ou e-mails parmi vos contacts) ; reprend la conversation existante à deux. title facultatif pour un groupe.",
    inputSchema: { type: "object", properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, title: { type: "string" } }, required: ["to", "text"] },
    run: async (user, args) => {
      const contacts = await listContacts(user);
      const ids = ((args.to as string[]) ?? []).map((ref) => {
        const q = ref.trim().toLowerCase();
        const hit = contacts.filter((c) => c.email.toLowerCase() === q || c.name.toLowerCase() === q);
        const part = hit.length ? hit : contacts.filter((c) => c.name.toLowerCase().includes(q));
        if (part.length !== 1) throw new ApiError(400, "BAD_ARGUMENT", part.length ? `« ${ref} » est ambigu : ${part.map((c) => c.name).join(", ")}.` : `« ${ref} » ne fait pas partie de vos contacts.`);
        return part[0].id;
      });
      const r = await callApi<{ conversationId: string }>(user, "POST", "/messages/conversations", { participantIds: ids, title: s(args, "title"), body: textToHtml(s(args, "text", true)!) });
      return { ok: true, conversation_id: r.conversationId };
    },
  },
];
