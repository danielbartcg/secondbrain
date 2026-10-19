import { ApiClientError } from "@/lib/client";
import { isMyTask as _isMyTask, reconcile } from "@/lib/shared/project-model";
import { resolveMentions } from "@/lib/shared/task-model";
import {
  createActivitySchema,
  createCommentSchema,
  createFreeTaskSchema,
  createMindMapSchema,
  createNodeSchema,
  createProjectSchema,
  createStageSchema,
  createTaskSchema,
  createWorkSessionSchema,
  linkNodeTaskSchema,
  moveNodeSchema,
  orderMyTasksSchema,
  updateActivitySchema,
  updateMindMapSchema,
  updateNodeSchema,
  updateNotesSchema,
  updateProjectSchema,
  updateStageSchema,
  updateTaskSchema,
} from "@/lib/schemas";
import type { SearchKind } from "@/lib/search";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { byOrder, type LocalModel } from "./model";
import { NetworkError, remote, remoteForm, remoteUpload } from "./remote";
import type { Store } from "./store";
import { prerequisiteError } from "@/lib/shared/prerequisites";
import { applyCustomPatch, readCustomValues } from "@/lib/shared/custom-fields";
import { labelOf, newId, type SyncEngine } from "./sync";
import type { Entity, Profile, Row } from "./types";

void _isMyTask;

/**
 * API locale de l'application native : sert les mêmes routes /api/v1 que le
 * serveur depuis la base hors ligne, pour le périmètre « projets et cartes ».
 * Chaque écriture applique localement les règles du serveur (pour un
 * affichage immédiat et juste), puis ajoute une opération à la file de
 * synchronisation : le serveur reste l'autorité et ses valeurs reviennent au
 * pull suivant. Hors périmètre (équipe, livrables, documents, administration,
 * notifications, profil…), la requête est relayée au serveur quand le réseau
 * est disponible.
 */

type Handler = (p: { params: string[]; body: unknown; query: URLSearchParams }) => Promise<unknown> | unknown;

const now = () => new Date().toISOString();
const notFound = (what: string) => new ApiClientError(404, "NOT_FOUND", `${what} introuvable.`);
const badRequest = (message: string) => new ApiClientError(400, "BAD_REQUEST", message);
const forbidden = () => new ApiClientError(403, "FORBIDDEN", "Accès refusé.");
const toDay = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.length === 10 ? `${v}T00:00:00.000Z` : new Date(v).toISOString());

function parse<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  try {
    return schema.parse(body ?? {});
  } catch (e) {
    if (e instanceof ZodError) throw new ApiClientError(400, "VALIDATION", "Données invalides.", e.flatten());
    throw e;
  }
}

/** Retire les clés indéfinies (champs non fournis). */
function defined(o: Row): Row {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function createLocalApi(store: Store, sync: SyncEngine, model: LocalModel) {
  const me = (): Profile => model.me;

  // --- Utilitaires d'écriture ---------------------------------------------------------
  function enqueue(entity: Entity, id: string, op: "create" | "update" | "delete", fields?: Row) {
    sync.enqueue(entity, id, op, fields ? defined(fields) : undefined, labelOf(entity, store.get(entity, id)));
  }

  /** Renumérote des frères 0..n-1, en insérant éventuellement `insertId` à `index` (comme le serveur). */
  function resequence(entity: Entity, pred: (r: Row) => boolean, insertId?: string, index?: number) {
    const siblings = store.where(entity, (r) => pred(r) && r.id !== insertId).sort(byOrder);
    const ids = siblings.map((s) => s.id as string);
    if (insertId) ids.splice(index === undefined ? ids.length : Math.min(index, ids.length), 0, insertId);
    ids.forEach((id, order) => {
      const r = store.get(entity, id);
      if (r && r.order !== order) store.put(entity, id, { ...r, order });
    });
  }

  const must = (entity: Entity, id: string, what: string) => {
    const r = store.get(entity, id);
    if (!r) throw notFound(what);
    return r;
  };
  const projectResp = (pid: string) => ({ project: model.project(pid) });
  const taskResp = (taskId: string, projectId: string | null) => ({ project: projectId ? model.project(projectId) : null, task: model.task(taskId) });
  const touchProject = (pid: string | null | undefined) => {
    if (pid && store.get("Project", pid)) store.patch("Project", pid, {});
  };

  /** Relais vers le serveur (fonctions hors périmètre hors ligne). */
  async function online(method: string, path: string, body?: unknown): Promise<unknown> {
    try {
      // Fichiers (documents, livrables) : formulaire multipart, comme sur le site.
      const r = typeof FormData !== "undefined" && body instanceof FormData ? await remoteForm(path, body) : await remote(method, path, body);
      if (r.status >= 400) {
        const err = (r.data as { error?: { code: string; message: string; details?: unknown } }).error;
        throw new ApiClientError(r.status, err?.code ?? `HTTP_${r.status}`, err?.message ?? `Erreur ${r.status}`, err?.details);
      }
      // Écriture faite sur le serveur : on récupère tout de suite ses effets (membre ajouté,
      // livrable créé…) pour que les écrans locaux suivants les voient.
      if (method !== "GET") await sync.syncNow().catch(() => {});
      return r.data;
    } catch (e) {
      if (e instanceof NetworkError) throw new ApiClientError(503, "OFFLINE", "Cette action nécessite une connexion au serveur.");
      throw e;
    }
  }

  // --- Cartes mentales -------------------------------------------------------------------
  // Droits comme le serveur (src/lib/map-access.ts) : lecture seule refusée (403), suppression = propriétaire.
  function writableMap(mapId: string) {
    must("MindMap", mapId, "Carte");
    if (model.mapAccess(mapId) === "read") throw new ApiClientError(403, "READ_ONLY", "Cette carte vous est partagée en lecture seule.");
  }
  function ownMap(mapId: string) {
    must("MindMap", mapId, "Carte");
    if (model.mapAccess(mapId) !== "owner") throw new ApiClientError(403, "FORBIDDEN", "Seul le propriétaire de la carte peut faire cela.");
  }

  function mapResp(mapId: string) {
    const m = model.mindmap(mapId);
    if (!m) throw notFound("Carte");
    return { mindmap: m };
  }
  /** Lecture d'une carte : locale, sinon serveur (carte partagée pas encore reçue). */
  async function mapRead(mapId: string) {
    return model.mindmap(mapId) ? mapResp(mapId) : online("GET", `/mindmaps/${encodeURIComponent(mapId)}`);
  }

  function createMap(body: unknown) {
    const { title } = parse(createMindMapSchema, body);
    const id = newId();
    const rootId = newId();
    const t = now();
    store.put("MindMap", id, { id, ownerId: me().id, title, createdAt: t, updatedAt: t });
    store.put("MindNode", rootId, { id: rootId, mapId: id, parentId: null, title, notes: "", color: null, collapsed: false, status: "OPEN", order: 0, x: null, y: null, createdAt: t, updatedAt: t });
    sync.enqueue("MindMap", id, "create", { title, rootId }, title);
    return mapResp(id);
  }

  function updateMap(mapId: string, body: unknown) {
    const input = parse(updateMindMapSchema, body);
    writableMap(mapId);
    if (input.title) {
      store.patch("MindMap", mapId, { title: input.title });
      for (const root of store.where("MindNode", (n) => n.mapId === mapId && !n.parentId)) store.patch("MindNode", root.id, { title: input.title });
      enqueue("MindMap", mapId, "update", { title: input.title });
    }
    return mapResp(mapId);
  }

  function deleteMap(mapId: string) {
    ownMap(mapId);
    enqueue("MindMap", mapId, "delete");
    store.removeCascade("MindMap", mapId);
    return { ok: true };
  }

  function node(mapId: string, nodeId: string) {
    const n = store.get("MindNode", nodeId);
    if (!n || n.mapId !== mapId) throw notFound("Nœud");
    return n;
  }

  function createNode(mapId: string, body: unknown) {
    writableMap(mapId);
    const input = parse(createNodeSchema, body);
    const parent = node(mapId, input.parentId);
    const id = newId();
    const t = now();
    store.put("MindNode", id, { id, mapId, parentId: parent.id, title: input.title, notes: "", color: null, collapsed: false, status: "OPEN", order: 1_000_000, x: null, y: null, createdAt: t, updatedAt: t });
    resequence("MindNode", (r) => r.mapId === mapId && r.parentId === parent.id, id, input.index);
    if (parent.collapsed) store.patch("MindNode", parent.id, { collapsed: false });
    store.patch("MindMap", mapId, {});
    sync.enqueue("MindNode", id, "create", defined({ mapId, parentId: parent.id, title: input.title, order: input.index }), input.title);
    return { node: model.nodeDto(store.get("MindNode", id)!) };
  }

  function updateNode(mapId: string, nodeId: string, body: unknown) {
    const input = parse(updateNodeSchema, body);
    writableMap(mapId);
    const n = node(mapId, nodeId);
    const fields = defined({ title: input.title, notes: input.notes, color: input.color, collapsed: input.collapsed, status: input.status, x: input.x, y: input.y });
    store.patch("MindNode", nodeId, fields);
    if (!n.parentId && input.title) store.patch("MindMap", mapId, { title: input.title });
    store.patch("MindMap", mapId, {});
    if (Object.keys(fields).length) enqueue("MindNode", nodeId, "update", fields);
    return { node: model.nodeDto(store.get("MindNode", nodeId)!) };
  }

  function moveNode(mapId: string, nodeId: string, body: unknown) {
    const input = parse(moveNodeSchema, body);
    writableMap(mapId);
    const n = node(mapId, nodeId);
    if (!n.parentId) throw badRequest("La racine ne peut pas être déplacée.");
    const target = node(mapId, input.parentId);
    if (target.id === n.id) throw badRequest("Un nœud ne peut pas être son propre parent.");
    for (let cur = target.parentId as string | null; cur; cur = store.get("MindNode", cur)?.parentId ?? null) {
      if (cur === n.id) throw badRequest("Impossible de déplacer un nœud dans sa propre branche.");
    }
    const oldParent = n.parentId;
    store.patch("MindNode", nodeId, { parentId: target.id, order: 1_000_000 });
    resequence("MindNode", (r) => r.mapId === mapId && r.parentId === target.id, nodeId, input.index);
    if (oldParent !== target.id) resequence("MindNode", (r) => r.mapId === mapId && r.parentId === oldParent);
    if (target.collapsed) store.patch("MindNode", target.id, { collapsed: false });
    enqueue("MindNode", nodeId, "update", defined({ parentId: target.id, order: input.index }));
    return { node: model.nodeDto(store.get("MindNode", nodeId)!) };
  }

  function deleteNode(mapId: string, nodeId: string) {
    writableMap(mapId);
    const n = node(mapId, nodeId);
    if (!n.parentId) throw badRequest("La racine ne peut pas être supprimée.");
    enqueue("MindNode", nodeId, "delete");
    store.removeCascade("MindNode", nodeId);
    resequence("MindNode", (r) => r.mapId === mapId && r.parentId === n.parentId);
    return { ok: true };
  }

  function resetLayout(mapId: string) {
    writableMap(mapId);
    for (const n of store.where("MindNode", (r) => r.mapId === mapId && (r.x != null || r.y != null))) {
      store.patch("MindNode", n.id, { x: null, y: null });
      enqueue("MindNode", n.id, "update", { x: null, y: null });
    }
    return mapResp(mapId);
  }

  function linkTask(mapId: string, nodeId: string, body: unknown) {
    writableMap(mapId);
    node(mapId, nodeId);
    const { taskId } = parse(linkNodeTaskSchema, body);
    must("Task", taskId, "Tâche");
    const key = `${nodeId}:${taskId}`;
    if (!store.get("MindNodeTask", key)) {
      store.put("MindNodeTask", key, { nodeId, taskId, createdAt: now() });
      enqueue("MindNodeTask", key, "create");
    }
    return model.nodeTasks(nodeId);
  }

  function unlinkTask(mapId: string, nodeId: string, taskId: string) {
    writableMap(mapId);
    node(mapId, nodeId);
    const key = `${nodeId}:${taskId}`;
    if (store.get("MindNodeTask", key)) {
      enqueue("MindNodeTask", key, "delete");
      store.remove("MindNodeTask", key);
    }
    return model.nodeTasks(nodeId);
  }

  // --- Projets, étapes, activités ----------------------------------------------------------
  /**
   * Champs personnalisés : validés contre les dernières définitions connues
   * (sinon acceptés, le serveur valide à la synchro). Renvoie les valeurs
   * locales et l'état complet à envoyer (null = vider) pour une fusion exacte.
   */
  function customValues(current: Record<string, string>, patch: Record<string, string | null>) {
    let values: Record<string, string>;
    if (store.meta.customFields) {
      const r = applyCustomPatch(store.meta.customFields, current, patch);
      if ("error" in r) throw badRequest(r.error);
      values = r.values;
    } else {
      values = { ...current };
      for (const [k, v] of Object.entries(patch)) if (v && v.trim()) values[k] = v.trim(); else delete values[k];
    }
    const send: Record<string, string | null> = Object.fromEntries(Object.keys(current).map((k) => [k, null]));
    Object.assign(send, values);
    return { values, send };
  }

  function createProject(body: unknown) {
    const input = parse(createProjectSchema, body);
    const custom = input.customFields ? customValues({}, input.customFields) : null;
    const id = newId();
    const t = now();
    const u = me();
    store.put("Project", id, { id, ownerId: u.id, name: input.name, description: input.description, notes: "", customFields: custom?.values ?? {}, color: input.color ?? null, status: input.status ?? "ACTIVE", startDate: toDay(input.startDate) ?? null, dueDate: toDay(input.dueDate) ?? null, createdAt: t, updatedAt: t });
    // Membre provisoire (le serveur crée le vrai à la synchro) : on peut s'affecter des tâches tout de suite.
    // Fiche membre « moi » : le serveur la crée avec le même identifiant (ownerMemberId),
    // si bien que les tâches affectées hors ligne restent valides à la synchronisation.
    const mid = newId("pm");
    store.put("ProjectMember", mid, { id: mid, projectId: id, userId: u.id, name: u.name, email: u.email, role: "Chef de projet", color: null, createdAt: t });
    sync.enqueue("Project", id, "create", defined({ name: input.name, description: input.description, color: input.color, status: input.status, startDate: input.startDate, dueDate: input.dueDate, ownerMemberId: mid, customFields: custom?.values }), input.name);
    return projectResp(id);
  }

  function updateProject(pid: string, body: unknown) {
    const input = parse(updateProjectSchema, body);
    const p = must("Project", pid, "Projet");
    const custom = input.customFields ? customValues(readCustomValues(p.customFields), input.customFields) : null;
    const fields = defined({ name: input.name, description: input.description, color: input.color, status: input.status, startDate: input.startDate, dueDate: input.dueDate, customFields: custom?.send });
    store.patch("Project", pid, { ...fields, ...defined({ startDate: toDay(input.startDate), dueDate: toDay(input.dueDate), customFields: custom?.values }) });
    if (Object.keys(fields).length) enqueue("Project", pid, "update", fields);
    return projectResp(pid);
  }

  function deleteProject(pid: string) {
    const p = must("Project", pid, "Projet");
    if (p.ownerId !== me().id) throw forbidden();
    enqueue("Project", pid, "delete");
    store.removeCascade("Project", pid);
    return { ok: true };
  }

  function createStage(pid: string, body: unknown) {
    must("Project", pid, "Projet");
    const input = parse(createStageSchema, body);
    const id = newId();
    const t = now();
    const order = store.where("Stage", (s) => s.projectId === pid).length;
    store.put("Stage", id, { id, projectId: pid, name: input.name, description: input.description, notes: "", order, startDate: toDay(input.startDate) ?? null, dueDate: toDay(input.dueDate) ?? null, createdAt: t, updatedAt: t });
    touchProject(pid);
    sync.enqueue("Stage", id, "create", defined({ projectId: pid, name: input.name, description: input.description, startDate: input.startDate, dueDate: input.dueDate }), input.name);
    return projectResp(pid);
  }

  function updateStage(id: string, body: unknown) {
    const input = parse(updateStageSchema, body);
    const s = must("Stage", id, "Étape");
    const fields = defined({ name: input.name, description: input.description, startDate: input.startDate, dueDate: input.dueDate, order: input.order });
    store.patch("Stage", id, defined({ name: input.name, description: input.description, startDate: toDay(input.startDate), dueDate: toDay(input.dueDate) }));
    if (input.order !== undefined) resequence("Stage", (r) => r.projectId === s.projectId, id, input.order);
    touchProject(s.projectId);
    if (Object.keys(fields).length) enqueue("Stage", id, "update", fields);
    return projectResp(s.projectId);
  }

  function deleteStage(id: string) {
    const s = must("Stage", id, "Étape");
    // Comme le serveur : les tâches supprimées ne restent prérequises de personne.
    for (const t of store.where("Task", (r) => r.stageId === id)) dropFromPrerequisites(t.id as string);
    enqueue("Stage", id, "delete");
    store.removeCascade("Stage", id);
    resequence("Stage", (r) => r.projectId === s.projectId);
    touchProject(s.projectId);
    return projectResp(s.projectId);
  }

  function createActivity(stageId: string, body: unknown) {
    const s = must("Stage", stageId, "Étape");
    const input = parse(createActivitySchema, body);
    const id = newId();
    const t = now();
    const order = store.where("Activity", (a) => a.stageId === stageId).length;
    store.put("Activity", id, { id, stageId, name: input.name, description: input.description, notes: "", order, createdAt: t, updatedAt: t });
    touchProject(s.projectId);
    sync.enqueue("Activity", id, "create", { stageId, name: input.name, description: input.description }, input.name);
    return projectResp(s.projectId);
  }

  function updateActivity(id: string, body: unknown) {
    const input = parse(updateActivitySchema, body);
    const a = must("Activity", id, "Activité");
    const s = must("Stage", a.stageId, "Étape");
    store.patch("Activity", id, defined({ name: input.name, description: input.description }));
    if (input.order !== undefined) resequence("Activity", (r) => r.stageId === a.stageId, id, input.order);
    touchProject(s.projectId);
    const fields = defined({ name: input.name, description: input.description, order: input.order });
    if (Object.keys(fields).length) enqueue("Activity", id, "update", fields);
    return projectResp(s.projectId);
  }

  function deleteActivity(id: string) {
    const a = must("Activity", id, "Activité");
    for (const t of store.where("Task", (r) => r.activityId === id)) dropFromPrerequisites(t.id as string);
    const s = must("Stage", a.stageId, "Étape");
    enqueue("Activity", id, "delete");
    store.removeCascade("Activity", id);
    resequence("Activity", (r) => r.stageId === a.stageId);
    touchProject(s.projectId);
    return projectResp(s.projectId);
  }

  // --- Tâches (mêmes règles que src/lib/projects.ts) ------------------------------------------
  type Att = { projectId: string | null; stageId: string | null; activityId: string | null };

  function resolveAttachment(target: { projectId?: string | null; stageId?: string | null; activityId?: string | null }): Att {
    if (target.activityId) {
      const a = must("Activity", target.activityId, "Activité");
      const s = must("Stage", a.stageId, "Étape");
      return { projectId: s.projectId, stageId: s.id, activityId: a.id };
    }
    if (target.stageId) {
      const s = must("Stage", target.stageId, "Étape");
      return { projectId: s.projectId, stageId: s.id, activityId: null };
    }
    if (target.projectId) {
      must("Project", target.projectId, "Projet");
      return { projectId: target.projectId, stageId: null, activityId: null };
    }
    return { projectId: null, stageId: null, activityId: null };
  }

  const siblingPred = (att: Att, ownerId: string) => (r: Row) =>
    att.stageId ? r.stageId === att.stageId && (r.activityId ?? null) === att.activityId : att.projectId ? r.projectId === att.projectId && !r.stageId : !r.projectId && r.ownerId === ownerId;

  function checkMember(projectId: string | null, memberId: string | null | undefined) {
    if (!memberId) return;
    const m = store.get("ProjectMember", memberId);
    if (!m || m.projectId !== projectId) throw badRequest("Ce membre n'appartient pas au projet.");
  }

  function setContributors(taskId: string, ids: string[]) {
    const current = store.where("TaskContributor", (c) => c.taskId === taskId);
    for (const c of current) if (!ids.includes(c.memberId)) store.remove("TaskContributor", `${taskId}:${c.memberId}`);
    for (const mid of ids) if (!current.some((c) => c.memberId === mid)) store.put("TaskContributor", `${taskId}:${mid}`, { taskId, memberId: mid, createdAt: now() });
  }

  /** Prérequis : mêmes règles que le serveur (src/lib/shared/prerequisites.ts). */
  function checkPrerequisites(taskId: string, projectId: string | null, ids: string[] | undefined): string[] | undefined {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (!projectId) throw badRequest("Une tâche sans projet ne peut pas avoir de prérequis.");
    const tasks = store.where("Task", (x) => x.projectId === projectId).map((x) => ({ id: x.id as string, prerequisiteIds: (x.prerequisiteIds as string[] | undefined) ?? [] }));
    const error = prerequisiteError(taskId, unique, tasks);
    if (error) throw badRequest(error);
    return unique;
  }

  function dropFromPrerequisites(taskId: string) {
    for (const x of store.where("Task", (r) => ((r.prerequisiteIds as string[] | undefined) ?? []).includes(taskId))) {
      store.patch("Task", x.id as string, { prerequisiteIds: (x.prerequisiteIds as string[]).filter((p) => p !== taskId) });
    }
  }

  function createTask(target: { projectId?: string | null; stageId?: string | null; activityId?: string | null; nodeId?: string | null }, body: unknown) {
    const input = parse(createTaskSchema, body);
    const att = resolveAttachment(target);
    if (target.nodeId) writableMap(must("MindNode", target.nodeId, "Nœud").mapId);
    if (input.assigneeId || input.supervisorId || input.contributorIds?.length) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      checkMember(att.projectId, input.assigneeId);
      checkMember(att.projectId, input.supervisorId);
      for (const c of input.contributorIds ?? []) checkMember(att.projectId, c);
    }
    const { status, progress } = reconcile({ status: "TODO", progress: 0 }, input);
    const id = newId();
    const prerequisiteIds = checkPrerequisites(id, att.projectId, input.prerequisiteIds) ?? [];
    const t = now();
    const u = me();
    const order = store.where("Task", siblingPred(att, u.id)).length;
    store.put("Task", id, {
      id,
      ownerId: u.id,
      ...att,
      assigneeId: input.assigneeId ?? null,
      supervisorId: input.supervisorId ?? null,
      name: input.name,
      description: input.description,
      notes: "",
      status,
      progress,
      priority: input.priority ?? "MEDIUM",
      complexity: input.complexity ?? "MEDIUM",
      order,
      startDate: toDay(input.startDate) ?? null,
      dueDate: toDay(input.dueDate) ?? null,
      closedAt: status === "CLOSED" ? t : null,
      prerequisiteIds,
      createdAt: t,
      updatedAt: t,
    });
    if (input.contributorIds?.length) setContributors(id, [...new Set(input.contributorIds)]);
    if (target.nodeId) store.put("MindNodeTask", `${target.nodeId}:${id}`, { nodeId: target.nodeId, taskId: id, createdAt: t });
    touchProject(att.projectId);
    sync.enqueue("Task", id, "create", defined({ ...att, nodeId: target.nodeId ?? undefined, name: input.name, description: input.description, status: input.status, progress: input.progress, priority: input.priority, complexity: input.complexity, startDate: input.startDate, dueDate: input.dueDate, assigneeId: input.assigneeId, supervisorId: input.supervisorId, contributorIds: input.contributorIds, prerequisiteIds: input.prerequisiteIds }), input.name);
    return taskResp(id, att.projectId);
  }

  function updateTask(taskId: string, body: unknown) {
    const input = parse(updateTaskSchema, body);
    const t = must("Task", taskId, "Tâche");
    let att: Att = { projectId: t.projectId ?? null, stageId: t.stageId ?? null, activityId: t.activityId ?? null };
    if (input.activityId) att = resolveAttachment({ activityId: input.activityId });
    else if (input.stageId) {
      att = resolveAttachment({ stageId: input.stageId });
      if (att.stageId === t.stageId && input.activityId === undefined) att.activityId = t.activityId ?? null;
    } else if (input.activityId === null && input.stageId === undefined && input.projectId === undefined) att = { ...att, activityId: null };
    else if (input.stageId === null && input.projectId === undefined) att = { projectId: t.projectId ?? null, stageId: null, activityId: null };
    else if (input.projectId !== undefined) {
      att = resolveAttachment({ projectId: input.projectId });
      if (att.projectId === t.projectId) att = { projectId: t.projectId ?? null, stageId: t.stageId ?? null, activityId: t.activityId ?? null };
    }
    // Sortir une tâche de son projet : réservé à son créateur ou au propriétaire du projet (comme le serveur).
    if (t.projectId && att.projectId === null && t.ownerId !== me().id && store.get("Project", t.projectId)?.ownerId !== me().id) {
      throw new ApiClientError(403, "FORBIDDEN", "Seul le créateur de la tâche ou le propriétaire du projet peut la détacher du projet.");
    }
    const moved = att.projectId !== (t.projectId ?? null) || att.stageId !== (t.stageId ?? null) || att.activityId !== (t.activityId ?? null);
    const projectChanged = att.projectId !== (t.projectId ?? null);
    const { status, progress } = reconcile({ status: t.status, progress: t.progress }, input);

    let closedAt: string | null | undefined;
    if (status === "CLOSED" && t.status !== "CLOSED") closedAt = now();
    if (status !== "CLOSED" && t.status === "CLOSED") closedAt = null;
    if (input.closedAt !== undefined) {
      if (status !== "CLOSED") {
        if (input.closedAt !== null) throw badRequest("La date de clôture n'est modifiable que sur une tâche clôturée.");
      } else {
        if (input.closedAt === null) throw badRequest("Une tâche clôturée garde une date de clôture.");
        closedAt = toDay(input.closedAt);
      }
    }

    let assigneeId = input.assigneeId;
    let supervisorId = input.supervisorId;
    let contributorIds = input.contributorIds;
    let prerequisiteInput = input.prerequisiteIds;
    if (projectChanged) {
      if (assigneeId === undefined) assigneeId = null;
      if (supervisorId === undefined) supervisorId = null;
      if (contributorIds === undefined) contributorIds = [];
      if (prerequisiteInput === undefined) prerequisiteInput = [];
      dropFromPrerequisites(taskId);
    }
    const prerequisiteIds = checkPrerequisites(taskId, att.projectId, prerequisiteInput);
    if (assigneeId || supervisorId || contributorIds?.length) {
      if (!att.projectId) throw badRequest("Une tâche sans projet ne peut pas être affectée.");
      checkMember(att.projectId, assigneeId);
      checkMember(att.projectId, supervisorId);
      for (const c of contributorIds ?? []) checkMember(att.projectId, c);
    }

    store.put("Task", taskId, {
      ...t,
      ...defined({ name: input.name, description: input.description, priority: input.priority, complexity: input.complexity, assigneeId, supervisorId, startDate: toDay(input.startDate), dueDate: toDay(input.dueDate), closedAt, prerequisiteIds }),
      status,
      progress,
      ...att,
      order: moved ? 1_000_000 : t.order,
      updatedAt: now(),
    });
    if (contributorIds !== undefined) setContributors(taskId, [...new Set(contributorIds)]);
    if (moved || input.order !== undefined) {
      resequence("Task", siblingPred(att, t.ownerId), taskId, input.order);
      if (moved) resequence("Task", siblingPred({ projectId: t.projectId ?? null, stageId: t.stageId ?? null, activityId: t.activityId ?? null }, t.ownerId));
    }
    touchProject(att.projectId);
    if (projectChanged) touchProject(t.projectId);

    // L'opération reprend la demande telle quelle : le serveur rejoue les mêmes règles.
    const fields = defined({ ...input });
    if (Object.keys(fields).length) enqueue("Task", taskId, "update", fields);
    return taskResp(taskId, att.projectId);
  }

  function deleteTask(taskId: string) {
    const t = must("Task", taskId, "Tâche");
    enqueue("Task", taskId, "delete");
    dropFromPrerequisites(taskId);
    store.removeCascade("Task", taskId);
    resequence("Task", siblingPred({ projectId: t.projectId ?? null, stageId: t.stageId ?? null, activityId: t.activityId ?? null }, t.ownerId));
    touchProject(t.projectId);
    return { project: t.projectId ? model.project(t.projectId) : null, task: null };
  }

  async function taskDetail(taskId: string) {
    const d = model.taskDetail(taskId);
    if (!d) return online("GET", `/tasks/${encodeURIComponent(taskId)}`);
    return { task: d };
  }

  function addComment(taskId: string, body: unknown) {
    const input = parse(createCommentSchema, body);
    const t = must("Task", taskId, "Tâche");
    if (input.parentId) {
      const parent = store.get("TaskComment", input.parentId);
      if (!parent || parent.taskId !== taskId) throw badRequest("Le commentaire auquel vous répondez n'existe plus.");
    }
    const members = t.projectId ? store.where("ProjectMember", (m) => m.projectId === t.projectId).map((m) => ({ id: m.id as string, name: m.name as string })) : [];
    const resolved = resolveMentions(input.body, members);
    const id = newId();
    const at = now();
    store.put("TaskComment", id, { id, taskId, authorId: me().id, parentId: input.parentId ?? null, body: resolved.body, mentions: resolved.mentions, createdAt: at, updatedAt: at });
    store.patch("Task", taskId, {});
    sync.enqueue("TaskComment", id, "create", defined({ taskId, body: input.body, parentId: input.parentId ?? undefined }), input.body.slice(0, 60));
    return taskDetail(taskId);
  }

  function deleteComment(id: string) {
    const c = must("TaskComment", id, "Commentaire");
    const t = must("Task", c.taskId, "Tâche");
    const owner = t.projectId ? store.get("Project", t.projectId)?.ownerId : t.ownerId;
    if (c.authorId !== me().id && owner !== me().id) throw forbidden();
    enqueue("TaskComment", id, "delete");
    store.removeCascade("TaskComment", id);
    return taskDetail(c.taskId);
  }

  function addSession(taskId: string, body: unknown) {
    const { date } = parse(createWorkSessionSchema, body);
    must("Task", taskId, "Tâche");
    const day = `${date}T00:00:00.000Z`;
    const exists = store.where("WorkSession", (s) => s.taskId === taskId && s.userId === me().id && String(s.date).slice(0, 10) === date)[0];
    if (!exists) {
      const id = newId();
      store.put("WorkSession", id, { id, taskId, userId: me().id, date: day, createdAt: now() });
      sync.enqueue("WorkSession", id, "create", { taskId, date }, date);
    }
    return { sessions: model.sessions(taskId) };
  }

  function deleteSession(id: string) {
    const s = store.get("WorkSession", id);
    if (!s || s.userId !== me().id) throw notFound("Session");
    enqueue("WorkSession", id, "delete");
    store.remove("WorkSession", id);
    return { sessions: model.sessions(s.taskId) };
  }

  // --- Prise de notes -----------------------------------------------------------------------
  function noteDoc(ref: string) {
    const d = model.noteDocument(ref);
    if (!d) throw notFound("Élément");
    return { document: d };
  }

  function saveNotes(kind: string, id: string, body: unknown) {
    const { notes } = parse(updateNotesSchema, body);
    switch (kind) {
      case "mindmap": {
        const root = store.where("MindNode", (n) => n.mapId === id && !n.parentId)[0];
        if (!root) throw notFound("Carte");
        writableMap(id);
        store.patch("MindNode", root.id, { notes });
        enqueue("MindNode", root.id, "update", { notes });
        break;
      }
      case "node":
        writableMap(must("MindNode", id, "Nœud").mapId);
        store.patch("MindNode", id, { notes });
        enqueue("MindNode", id, "update", { notes });
        break;
      case "project":
      case "stage":
      case "activity":
      case "task": {
        const entity = ({ project: "Project", stage: "Stage", activity: "Activity", task: "Task" } as const)[kind];
        must(entity, id, "Élément");
        store.patch(entity, id, { notes });
        enqueue(entity, id, "update", { notes });
        break;
      }
      default:
        throw badRequest("Cet élément ne porte pas de notes.");
    }
    return noteDoc(`${kind}:${id}`);
  }

  // --- Images de notes ------------------------------------------------------------------------
  async function upload(body: unknown) {
    const file = body instanceof FormData ? body.get("file") : null;
    if (!(file instanceof Blob)) throw badRequest("Fichier manquant.");
    try {
      return { url: await remoteUpload(file, (file as File).name || "image.png") };
    } catch (e) {
      if (!(e instanceof NetworkError)) throw new ApiClientError(400, "UPLOAD", e instanceof Error ? e.message : "Téléversement impossible.");
      // Hors ligne : l'image reste dans la note (data:) et sera téléversée à la synchro.
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { url: `data:${file.type || "image/png"};base64,${btoa(bin)}` };
    }
  }

  // --- Profil et session ------------------------------------------------------------------------
  function profile() {
    return { profile: me() };
  }

  async function updateProfile(body: unknown) {
    const r = (await online("PATCH", "/me", body)) as { profile: Profile };
    store.setMeta("user", r.profile);
    return r;
  }

  async function logout(body: unknown) {
    const force = !!(body && typeof body === "object" && (body as { force?: unknown }).force === true);
    if (!force) {
      await sync.syncNow().catch(() => {});
      const pending = store.outbox.length;
      const conflicts = store.conflicts.length;
      if (pending > 0) {
        throw new ApiClientError(409, "UNSYNCED_CHANGES", `${pending} modification${pending > 1 ? "s n'ont" : " n'a"} pas encore été envoyée${pending > 1 ? "s" : ""} au serveur : elle${pending > 1 ? "s seraient perdues" : " serait perdue"} à la déconnexion.`, { pending, conflicts });
      }
    }
    await remote("POST", "/auth/logout").catch(() => {});
    if (typeof window !== "undefined" && window.secondBrain) await window.secondBrain.setSession(null);
    sync.stop();
    await store.wipe();
    return { ok: true };
  }

  async function order(body: unknown) {
    const { taskIds } = parse(orderMyTasksSchema, body);
    store.setMeta("ranks", taskIds);
    try {
      const r = await remote("PUT", "/me/tasks/order", { taskIds });
      store.setMeta("pendingRanks", r.status < 400 ? null : taskIds);
    } catch {
      store.setMeta("pendingRanks", taskIds);
    }
    return { ok: true };
  }

  /** Dernière réponse par requête : affichée telle quelle hors ligne. */
  const lastNotifications = new Map<string, unknown>();
  async function notifications(path: string, query: URLSearchParams) {
    try {
      const key = path + (query.toString() ? `?${query}` : "");
      const r = await online("GET", key);
      lastNotifications.set(key, r);
      return r;
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 503) return lastNotifications.get(path + (query.toString() ? `?${query}` : "")) ?? { notifications: [], unreadCount: 0 };
      throw e;
    }
  }

  // --- Table de routage ----------------------------------------------------------------------------
  const routes: Array<[string, RegExp, Handler]> = [
    ["GET", /^\/auth\/me$/, () => ({ user: { id: me().id, email: me().email, name: me().name, firstName: me().firstName, lastName: me().lastName, avatarUrl: me().avatarUrl, theme: me().theme, role: me().role, isAdmin: me().isAdmin, createdAt: me().createdAt } })],
    ["POST", /^\/auth\/logout$/, ({ body }) => logout(body)],
    ["GET", /^\/me$/, () => profile()],
    ["PATCH", /^\/me$/, ({ body }) => updateProfile(body)],
    ["GET", /^\/dashboard$/, ({ query }) => ({ dashboard: model.dashboard(Math.min(365, Math.max(1, Number(query.get("horizon") ?? "30") || 30))) })],
    ["GET", /^\/search$/, ({ query }) => ({ results: model.search(query.get("q") ?? "", query.get("kinds")?.split(",").filter(Boolean) as SearchKind[] | undefined, Number(query.get("limit") ?? "6") || 6) })],
    // Cartes mentales
    ["GET", /^\/mindmaps$/, () => ({ mindmaps: model.mindmaps() })],
    ["POST", /^\/mindmaps$/, ({ body }) => createMap(body)],
    ["GET", /^\/mindmaps\/([^/]+)$/, ({ params }) => mapRead(params[0])],
    ["PATCH", /^\/mindmaps\/([^/]+)$/, ({ params, body }) => updateMap(params[0], body)],
    ["DELETE", /^\/mindmaps\/([^/]+)$/, ({ params }) => deleteMap(params[0])],
    ["DELETE", /^\/mindmaps\/([^/]+)\/layout$/, ({ params }) => resetLayout(params[0])],
    ["POST", /^\/mindmaps\/([^/]+)\/nodes$/, ({ params, body }) => createNode(params[0], body)],
    ["PATCH", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)$/, ({ params, body }) => updateNode(params[0], params[1], body)],
    ["DELETE", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)$/, ({ params }) => deleteNode(params[0], params[1])],
    ["POST", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)\/move$/, ({ params, body }) => moveNode(params[0], params[1], body)],
    ["GET", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)\/tasks$/, ({ params }) => (node(params[0], params[1]), model.nodeTasks(params[1]))],
    ["POST", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)\/tasks$/, ({ params, body }) => linkTask(params[0], params[1], body)],
    ["DELETE", /^\/mindmaps\/([^/]+)\/nodes\/([^/]+)\/tasks\/([^/]+)$/, ({ params }) => unlinkTask(params[0], params[1], params[2])],
    // Projets
    ["GET", /^\/projects$/, () => ({ projects: model.projects() })],
    ["POST", /^\/projects$/, ({ body }) => createProject(body)],
    ["GET", /^\/projects\/([^/]+)$/, ({ params }) => {
      const p = model.project(params[0]);
      // Hors périmètre local (pas encore synchronisé) : serveur.
      if (!p) return online("GET", `/projects/${encodeURIComponent(params[0])}`);
      return { project: p };
    }],
    ["PATCH", /^\/projects\/([^/]+)$/, ({ params, body }) => updateProject(params[0], body)],
    ["DELETE", /^\/projects\/([^/]+)$/, ({ params }) => deleteProject(params[0])],
    ["POST", /^\/projects\/([^/]+)\/stages$/, ({ params, body }) => createStage(params[0], body)],
    ["POST", /^\/projects\/([^/]+)\/tasks$/, ({ params, body }) => createTask({ projectId: params[0] }, body)],
    ["PATCH", /^\/stages\/([^/]+)$/, ({ params, body }) => updateStage(params[0], body)],
    ["DELETE", /^\/stages\/([^/]+)$/, ({ params }) => deleteStage(params[0])],
    ["POST", /^\/stages\/([^/]+)\/activities$/, ({ params, body }) => createActivity(params[0], body)],
    ["POST", /^\/stages\/([^/]+)\/tasks$/, ({ params, body }) => createTask({ stageId: params[0] }, body)],
    ["PATCH", /^\/activities\/([^/]+)$/, ({ params, body }) => updateActivity(params[0], body)],
    ["DELETE", /^\/activities\/([^/]+)$/, ({ params }) => deleteActivity(params[0])],
    ["POST", /^\/activities\/([^/]+)\/tasks$/, ({ params, body }) => createTask({ activityId: params[0] }, body)],
    // Tâches
    ["GET", /^\/tasks$/, () => ({ tasks: model.orphanTasks() })],
    ["POST", /^\/tasks$/, ({ body }) => {
      const { projectId, stageId, activityId, nodeId, ...rest } = parse(createFreeTaskSchema, body);
      return createTask({ projectId, stageId, activityId, nodeId }, rest);
    }],
    ["GET", /^\/tasks\/([^/]+)$/, ({ params }) => taskDetail(params[0])],
    ["PATCH", /^\/tasks\/([^/]+)$/, ({ params, body }) => updateTask(params[0], body)],
    ["DELETE", /^\/tasks\/([^/]+)$/, ({ params }) => deleteTask(params[0])],
    ["POST", /^\/tasks\/([^/]+)\/comments$/, ({ params, body }) => addComment(params[0], body)],
    ["DELETE", /^\/comments\/([^/]+)$/, ({ params }) => deleteComment(params[0])],
    ["POST", /^\/tasks\/([^/]+)\/sessions$/, ({ params, body }) => addSession(params[0], body)],
    ["DELETE", /^\/sessions\/([^/]+)$/, ({ params }) => deleteSession(params[0])],
    ["GET", /^\/me\/tasks$/, () => model.myTasks()],
    ["PUT", /^\/me\/tasks\/order$/, ({ body }) => order(body)],
    // Prise de notes
    ["GET", /^\/notes\/tree$/, ({ query }) => ({ parent: query.get("parent") ?? "root", children: model.treeChildren(query.get("parent") ?? "root") })],
    ["GET", /^\/notes\/([^/]+)\/([^/]+)$/, ({ params }) => noteDoc(`${params[0]}:${params[1]}`)],
    ["PATCH", /^\/notes\/([^/]+)\/([^/]+)$/, ({ params, body }) => saveNotes(params[0], params[1], body)],
    // Images de notes
    ["POST", /^\/uploads$/, ({ body }) => upload(body)],
    // Notifications : serveur si possible, sinon liste vide.
    ["GET", /^\/notifications$/, ({ query }) => notifications("/notifications", query)],
    // Champs personnalisés : serveur, dernière liste connue hors ligne.
    ["GET", /^\/custom-fields$/, async () => {
      try {
        const r = (await online("GET", "/custom-fields")) as { fields: NonNullable<typeof store.meta.customFields> };
        store.setMeta("customFields", r.fields);
        return r;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 503) return { fields: store.meta.customFields ?? [] };
        throw e;
      }
    }],
    // Types de projet personnels : serveur, dernière valeur connue hors ligne ;
    // les modifications sont relayées (et mises en cache via cette lecture).
    ["GET", /^\/me\/project-types$/, async () => {
      try {
        const r = (await online("GET", "/me/project-types")) as { projectTypes: NonNullable<typeof store.meta.projectTypes> };
        store.setMeta("projectTypes", r.projectTypes);
        return r;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 503 && store.meta.projectTypes) return { projectTypes: store.meta.projectTypes };
        throw e;
      }
    }],
    // Épingles : serveur (source de vérité), dernière liste connue hors ligne.
    ["GET", /^\/me\/pins$/, async () => {
      try {
        const r = (await online("GET", "/me/pins")) as { pins: NonNullable<typeof store.meta.pins> };
        store.setMeta("pins", r.pins);
        return r;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 503 && store.meta.pins) return { pins: store.meta.pins };
        throw e;
      }
    }],
  ];

  /** Transport branché sur `api` (src/lib/client.ts). */
  return async function handle(method: string, rawPath: string, body?: unknown): Promise<unknown> {
    const url = new URL(rawPath, "http://local");
    const path = url.pathname;
    for (const [m, re, h] of routes) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (!match) continue;
      // Création à partir d'un modèle : la structure du modèle n'est pas locale, le serveur s'en charge.
      if (method === "POST" && (path === "/projects" || path === "/mindmaps") && body && typeof body === "object" && (body as { templateId?: unknown }).templateId) {
        return online(method, rawPath, body);
      }
      try {
        return await h({ params: match.slice(1).map(decodeURIComponent), body, query: url.searchParams });
      } catch (e) {
        // Objet absent de la base locale (modèle, consultation, partage pas encore synchronisé) : serveur.
        if (e instanceof ApiClientError && e.status === 404) return online(method, rawPath, body);
        throw e;
      }
    }
    // Tout le reste (équipe, livrables, documents, dossiers, administration, mot de passe…) : serveur.
    return online(method, rawPath, body);
  };
}
