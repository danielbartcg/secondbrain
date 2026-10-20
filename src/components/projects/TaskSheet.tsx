"use client";

import { RichDescription } from "@/components/RichDescription";
import { RichTextEditor } from "@/components/RichTextEditor";
import { editorHtml } from "@/lib/shared/rich-text";
import { hasHtmlContent } from "@/lib/shared/project-model";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarDays, CalendarPlus, Check, Circle, CircleDot, CornerDownRight, Eye, Flag, FolderKanban, Gauge, Layers, Link2, Lock, MessageSquare, Plus, Send, Trash2, Unlink, User, Users, Workflow, X } from "lucide-react";
import { api } from "@/lib/client";
import type { MemberDto, ProjectDto, ProjectSummary, TaskMutation } from "@/lib/projects";
import type { TaskCommentDto, TaskDetailDto, WorkSessionDto } from "@/lib/tasks";
import type { NodeTasksResult } from "@/lib/tasks";
import { NotesPreview } from "@/components/notes/NotesPreview";
import { Backlinks } from "@/components/Backlinks";
import {
  Avatar,
  Badge,
  Button,
  COMPLEXITIES,
  COMPLEXITY_LABEL,
  InlineEdit,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  PriorityFlag,
  ProgressBar,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  formatDate,
  isFinished,
  errorMessage,
  selectClass,
  toInputDate,
  toast,
  todayYmd,
} from "@/components/ui";
import { PrerequisitesField } from "@/components/projects/PrerequisitesField";
import { MemberMultiSelect } from "@/components/projects/MemberMultiSelect";
import { TaskHistory } from "@/components/projects/TaskHistory";

/**
 * Fiche tâche : champs mis en forme (statut, avancement, priorité, complexité,
 * responsable, dates, description), **rattachement** facultatif projet ›
 * étape › activité (une tâche peut n'en avoir aucun : « sans projet »),
 * nœuds de carte mentale rattachés, sessions de travail planifiées, et fil de
 * commentaires hiérarchique (réponses imbriquées) avec mentions « @ ».
 */

type TaskResp = { task: TaskDetailDto };

export function TaskSheet({ initial, currentUserId }: { initial: TaskDetailDto; currentUserId: string }) {
  const router = useRouter();
  const [task, setTask] = useState(initial);
  const [saving, setSaving] = useState(0);
  /** « Enregistré » ne s'affiche qu'après une première sauvegarde. */
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState(initial.progress);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const { task } = await api.get<TaskResp>(`/tasks/${initial.id}`);
    setTask(task);
    setProgress(task.progress);
  }, [initial.id]);

  /** Les mutations de tâche renvoient le projet : on recharge la fiche ensuite. */
  const patch = useCallback(
    async (data: Record<string, unknown>) => {
      setSaving((s) => s + 1);
      try {
        await api.patch<TaskMutation>(`/tasks/${task.id}`, data);
        await reload();
      } catch (e) {
        console.error(e);
        toast(errorMessage(e, "Enregistrement impossible."), "error");
        await reload().catch(() => {});
      } finally {
        setSaving((s) => s - 1);
        setSaved(true);
      }
    },
    [reload, task.id],
  );

  const onProgress = (value: number) => {
    setProgress(value);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      if (value !== task.progress) void patch({ progress: value });
    }, 400);
  };

  const late = task.dueDate && !isFinished(task.status) && new Date(task.dueDate) < new Date();
  const color = task.project?.color ?? "#64748b";
  const isOwner = (task.project?.ownerId ?? task.ownerId) === currentUserId;
  const members = task.project?.members ?? [];
  const backHref = task.project ? `/projects/${task.project.id}#plan` : "/projects/sans-projet";
  // Tâche d'un projet type : structure seulement (ni statut, ni personnes, ni dates, ni sessions, ni commentaires).
  const tpl = !!task.project?.isTemplate;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href={backHref} className="flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {task.project?.name ?? "Sans projet"}
        </Link>
        {task.stage && (
          <>
            <span>/</span>
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" /> {task.stage.name}
            </span>
          </>
        )}
        {task.activity && (
          <>
            <span>/</span>
            <span>{task.activity.name}</span>
          </>
        )}
        <span className={`ml-auto text-xs ${saving ? "text-warn" : "text-faint"}`} role="status">{saving ? "Enregistrement…" : saved ? "Enregistré" : ""}</span>
      </div>

      {tpl && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          <Layers className="h-4 w-4 shrink-0" /> Tâche d&apos;un projet type : priorité, complexité, prérequis, notes et description seront copiés dans les projets créés à partir du modèle.
        </p>
      )}
      {!task.canEdit && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Eye className="h-4 w-4 shrink-0" /> Consultation en lecture seule (administration ou tâche d&apos;un membre de votre équipe).
        </p>
      )}
      {/* En consultation, tout le contenu est désactivé (fieldset) et non cliquable. */}
      <fieldset disabled={!task.canEdit} className={`min-w-0 ${task.canEdit ? "" : "pointer-events-none"}`}>
      {/* Carte principale */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
            <Badge tone={PRIORITY_TONE[task.priority]}>
              <PriorityFlag priority={task.priority} className="!h-3 !w-3" /> {PRIORITY_LABEL[task.priority]}
            </Badge>
            {late && (
              <Badge tone="danger">
                <Flag className="h-3 w-3" /> En retard
              </Badge>
            )}
            {task.commentCount > 0 && (
              <Badge tone="neutral">
                <MessageSquare className="h-3 w-3" /> {task.commentCount}
              </Badge>
            )}
          </div>
          <InlineEdit value={task.name} onSave={(name) => patch({ name })} as="h1" className="-mx-1.5 mt-2 block text-2xl font-semibold leading-tight tracking-tight" />

          {/* Avancement */}
          {!tpl && (
          <>
          <div className="mt-5 flex items-center gap-3">
            <div className="flex flex-wrap gap-1">
              {(["TODO", "IN_PROGRESS", "DONE"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={task.status === s}
                  onClick={() => patch({ status: s })}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${
                    task.status === s ? "bg-brand-600 text-on-brand ring-brand-600" : "bg-surface text-ink-2 ring-line hover:bg-surface-2"
                  }`}
                >
                  {s === "TODO" ? <Circle className="h-3.5 w-3.5" /> : s === "IN_PROGRESS" ? <CircleDot className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {TASK_STATUS_LABEL[s]}
                </button>
              ))}
              {/* Clôture : action manuelle, proposée une fois la tâche terminée. */}
              {(task.status === "DONE" || task.status === "CLOSED") && (
                <button
                  type="button"
                  onClick={() => patch({ status: task.status === "CLOSED" ? "DONE" : "CLOSED" })}
                  title={task.status === "CLOSED" ? "Rouvrir (revient à Terminée)" : "Clôturer : la tâche sort du flux courant"}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${
                    task.status === "CLOSED" ? "bg-violet-700 text-surface ring-violet-700" : "bg-surface text-violet-700 ring-violet-200 hover:bg-violet-50"
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" /> {task.status === "CLOSED" ? "Clôturée" : "Clôturer"}
                </button>
              )}
            </div>
            <span className="ml-auto text-lg font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <ProgressBar percent={progress} color={color} className="h-2.5" />
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => onProgress(Number(e.target.value))} className="w-36 accent-brand-600" title="Avancement" aria-label="Avancement" />
          </div>
          </>
          )}

          {/* Rattachement : projet › étape › activité, tous facultatifs */}
          <AttachmentBlock task={task} patch={patch} />

          {/* Qualification */}
          <Block icon={<Gauge className="h-4 w-4" />} title="Qualification">
            <div className="grid gap-3 sm:grid-cols-2">
              <SubField icon={<Flag className="h-3.5 w-3.5" />} label="Priorité">
                <select value={task.priority} onChange={(e) => patch({ priority: e.target.value })} className={`${selectClass} w-full`}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </SubField>
              <SubField icon={<Gauge className="h-3.5 w-3.5" />} label="Complexité">
                <select value={task.complexity} onChange={(e) => patch({ complexity: e.target.value })} className={`${selectClass} w-full`}>
                  {COMPLEXITIES.map((c) => (
                    <option key={c} value={c}>
                      {COMPLEXITY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </SubField>
            </div>
          </Block>

          {/* Acteurs */}
          {!tpl && (
          <Block icon={<Users className="h-4 w-4" />} title="Acteurs" hint={task.project ? undefined : "rattachez la tâche à un projet pour désigner des personnes"}>
            <div className="grid gap-3 sm:grid-cols-3">
              <SubField icon={<User className="h-3.5 w-3.5" />} label="Responsable">
                <div className="flex items-center gap-2">
                  {task.assignee && <Avatar id={task.assignee.id} name={task.assignee.name} color={task.assignee.color} src={task.assignee.avatarUrl} size={26} />}
                  <select value={task.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} disabled={!task.project} className={`${selectClass} min-w-0 flex-1 disabled:opacity-50`}>
                    <option value="">— Personne —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.role ? ` (${m.role})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </SubField>
              <SubField icon={<Eye className="h-3.5 w-3.5" />} label="Superviseur">
                <div className="flex items-center gap-2">
                  {task.supervisor && <Avatar id={task.supervisor.id} name={task.supervisor.name} color={task.supervisor.color} src={task.supervisor.avatarUrl} size={26} />}
                  <select value={task.supervisorId ?? ""} onChange={(e) => patch({ supervisorId: e.target.value || null })} disabled={!task.project} title="Une seule personne supervise la tâche" className={`${selectClass} min-w-0 flex-1 disabled:opacity-50`}>
                    <option value="">— Personne —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.role ? ` (${m.role})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </SubField>
              <SubField icon={<Users className="h-3.5 w-3.5" />} label="Contributeurs" asLabel={false}>
                <MemberMultiSelect members={members} value={task.contributorIds} disabled={!task.project} onChange={(contributorIds) => patch({ contributorIds })} />
              </SubField>
            </div>
          </Block>
          )}

          {/* Calendrier */}
          <Block icon={tpl ? <Link2 className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />} title={tpl ? "Prérequis" : "Calendrier"}>
            {!tpl && (
            <div className="grid gap-3 sm:grid-cols-3">
              <SubField icon={<CalendarDays className="h-3.5 w-3.5" />} label="Début">
                <input type="date" value={toInputDate(task.startDate)} onChange={(e) => patch({ startDate: e.target.value || null })} className={`${selectClass} w-full`} />
              </SubField>
              <SubField icon={<CalendarDays className="h-3.5 w-3.5" />} label="Échéance">
                <input type="date" value={toInputDate(task.dueDate)} onChange={(e) => patch({ dueDate: e.target.value || null })} className={`${selectClass} w-full ${late ? "border-danger text-danger" : ""}`} />
              </SubField>
              <SubField icon={<Lock className="h-3.5 w-3.5" />} label="Date de clôture">
                <input
                  type="date"
                  value={toInputDate(task.closedAt)}
                  disabled={task.status !== "CLOSED"}
                  onChange={(e) => e.target.value && patch({ closedAt: e.target.value })}
                  title={task.status === "CLOSED" ? "Modifiable tant que la tâche est clôturée" : "Se remplit automatiquement à la clôture"}
                  className={`${selectClass} w-full disabled:opacity-50`}
                />
                {task.status !== "CLOSED" && <p className="mt-1 text-[11px] text-faint">Remplie automatiquement à la clôture.</p>}
              </SubField>
            </div>
            )}
            <div className={tpl ? "" : "mt-3 border-t border-line pt-3"}>
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                <Link2 className="h-3.5 w-3.5" /> Prérequis (tâches à terminer avant)
              </span>
              <PrerequisitesField task={task} disabled={!task.canEdit} onChange={(prerequisiteIds) => patch({ prerequisiteIds })} />
            </div>
          </Block>

          {/* Nœuds de carte mentale */}
          {!tpl && <NodeLinks task={task} onChange={(nodes) => setTask((t) => ({ ...t, nodes }))} />}

          {/* Notes riches (éditées dans « Prise de notes ») */}
          <NotesPreview html={task.notes} noteRef={`task:${task.id}`} className="mt-4 !rounded-xl !bg-surface-2/60 !p-3" />

          {/* Sessions de travail planifiées */}
          {!tpl && <WorkSessions task={task} onChange={(workSessions) => setTask((t) => ({ ...t, workSessions }))} />}

          <div className="mt-6">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Description</h2>
            <RichDescription value={task.description} documentKey={task.id} editable={task.canEdit} onSave={(description) => patch({ description })} />
          </div>

          {/* Liens [[…]] entrants */}
          {!tpl && <Backlinks objectRef={`task:${task.id}`} className="mt-6" />}

          {/* Piste d'audit */}
          <TaskHistory taskId={task.id} version={task.updatedAt} />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">
            <span>Dernière modification : {formatDate(task.updatedAt)}</span>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return;
                try {
                  await api.delete(`/tasks/${task.id}`);
                  router.push(backHref);
                } catch (e) {
                  toast(errorMessage(e, "Suppression impossible."), "error");
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer la tâche
            </Button>
          </div>
        </div>
      </div>

      {/* Commentaires */}
      {!tpl && <Comments task={task} currentUserId={currentUserId} isOwner={isOwner} onChange={setTask} />}
      </fieldset>
    </div>
  );
}


/** Bloc titré de la fiche (Qualification, Acteurs, Calendrier), même style que « Rattachement ». */
function Block({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface-2/60 p-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon} {title}
        {hint && <span className="font-normal text-faint">— {hint}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Champ d'un bloc : petit libellé au-dessus de la valeur. Par défaut un vrai
 * `<label>` (le contrôle qu'il contient est nommé) ; `asLabel={false}` quand
 * le contenu n'est pas un contrôle unique (il porte alors son propre nom).
 */
function SubField({ icon, label, children, asLabel = true }: { icon: React.ReactNode; label: string; children: React.ReactNode; asLabel?: boolean }) {
  const Tag = asLabel ? "label" : "div";
  return (
    <Tag className="block min-w-0">
      <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
        {icon} {label}
      </span>
      {children}
    </Tag>
  );
}

// --- Rattachement ------------------------------------------------------------

/**
 * Bloc « Rattachement » : projet (facultatif) › étape (facultative) › activité
 * (facultative). Les listes se chargent à la demande ; changer de projet
 * efface l'étape et l'activité ; « Sans projet » détache tout.
 */
function AttachmentBlock({ task, patch }: { task: TaskDetailDto; patch: (data: Record<string, unknown>) => Promise<void> }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [project, setProject] = useState<ProjectDto | null>(null);

  useEffect(() => {
    api
      .get<{ projects: ProjectSummary[] }>("/projects")
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!task.project) {
      setProject(null);
      return;
    }
    api
      .get<{ project: ProjectDto }>(`/projects/${task.project.id}`)
      .then((r) => setProject(r.project))
      .catch(() => {});
  }, [task.project?.id, task.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const stages = project?.stages ?? [];
  const activities = stages.find((s) => s.id === task.stageId)?.activities ?? [];

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <FolderKanban className="h-4 w-4" /> Rattachement
        <span className="font-normal text-faint">— projet, étape et activité sont facultatifs</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Projet</span>
          {/* Tâche d'un projet type : elle reste dans son modèle. */}
          <select value={task.project?.id ?? ""} onChange={(e) => patch({ projectId: e.target.value || null })} disabled={!!task.project?.isTemplate} className={`${selectClass} w-full disabled:opacity-60`}>
            <option value="">Sans projet</option>
            {/* Projet courant toujours proposé (consultation : il n'est pas dans « mes » projets). */}
            {[
              ...(task.project && !(projects ?? []).some((p) => p.id === task.project!.id) ? [{ id: task.project.id, name: task.project.name }] : []),
              ...(projects ?? []),
            ].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Étape</span>
          <select value={task.stageId ?? ""} onChange={(e) => patch({ stageId: e.target.value || null })} disabled={!task.project} className={`${selectClass} w-full disabled:opacity-50`}>
            <option value="">{task.project ? "Sans étape" : "—"}</option>
            {(stages.length ? stages : task.stage ? [{ id: task.stage.id, name: task.stage.name }] : []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Activité</span>
          <select value={task.activityId ?? ""} onChange={(e) => patch({ activityId: e.target.value || null })} disabled={!task.stage} className={`${selectClass} w-full disabled:opacity-50`}>
            <option value="">{task.stage ? "Sans activité" : "—"}</option>
            {(activities.length ? activities : task.activity ? [{ id: task.activity.id, name: task.activity.name }] : []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** Nœuds de carte mentale auxquels la tâche est rattachée (détachement possible). */
function NodeLinks({ task, onChange }: { task: TaskDetailDto; onChange: (nodes: TaskDetailDto["nodes"]) => void }) {
  if (task.nodes.length === 0) return null;
  async function unlink(n: TaskDetailDto["nodes"][number]) {
    try {
      await api.delete<NodeTasksResult>(`/mindmaps/${n.mapId}/nodes/${n.id}/tasks/${task.id}`);
      onChange(task.nodes.filter((x) => x.id !== n.id));
    } catch (e) {
      toast(errorMessage(e, "Détachement impossible."), "error");
    }
  }
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Workflow className="h-4 w-4" /> Nœuds de carte mentale
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {task.nodes.map((n) => (
          <li key={n.id} className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
            <Link href={`/mindmaps/${n.mapId}?node=${n.id}`} className="hover:underline">
              <span className="font-medium">{n.title}</span> <span className="text-muted">· {n.mapTitle}</span>
            </Link>
            <button type="button" onClick={() => unlink(n)} className="-my-1 rounded p-1.5 text-faint hover:bg-red-50 hover:text-danger md:my-0 md:p-0.5" title="Détacher de ce nœud" aria-label={`Détacher du nœud « ${n.title} »`}>
              <Unlink className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Sessions de travail -----------------------------------------------------

function WorkSessions({ task, onChange }: { task: TaskDetailDto; onChange: (sessions: WorkSessionDto[]) => void }) {
  const [date, setDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);
  const lateCount = task.workSessions.filter((s) => s.late).length;

  async function add() {
    if (!date) return;
    setBusy(true);
    try {
      const { sessions } = await api.post<{ sessions: WorkSessionDto[] }>(`/tasks/${task.id}/sessions`, { date });
      onChange(sessions);
    } catch (e) {
      toast(errorMessage(e, "Planification impossible."), "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: WorkSessionDto) {
    try {
      const { sessions } = await api.delete<{ sessions: WorkSessionDto[] }>(`/sessions/${s.id}`);
      onChange(sessions);
    } catch (e) {
      toast(errorMessage(e, "Retrait impossible."), "error");
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <CalendarPlus className="h-4 w-4" /> Sessions de travail planifiées
        </h2>
        {lateCount > 0 && (
          <Badge tone="danger">
            <AlertTriangle className="h-3 w-3" /> {lateCount} après l&apos;échéance
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Jour de la session"
            className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-xs"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={busy || !date}>
            <Plus className="h-3.5 w-3.5" /> Planifier
          </Button>
        </div>
      </div>
      {task.workSessions.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Aucune session planifiée. Choisissez un jour ci-dessus, ou glissez la tâche sur le calendrier dans{" "}
          <Link href="/organize#calendar" className="text-brand-700 hover:underline">
            Mes tâches
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {task.workSessions.map((s) => (
            <li
              key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${s.late ? "border-danger bg-red-50 text-red-800" : "border-line bg-surface text-ink-2"}`}
              title={s.late ? "Cette session est après l'échéance de la tâche" : undefined}
            >
              {s.late && <AlertTriangle className="h-3.5 w-3.5" />}
              <CalendarDays className="h-3.5 w-3.5 opacity-60" />
              <span className="font-medium">{new Date(`${s.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>
              {!s.mine && <span className="text-muted">· {s.userName}</span>}
              {s.mine && (
                <button type="button" onClick={() => remove(s)} className="-my-1 rounded p-1.5 opacity-50 hover:bg-surface-3 hover:opacity-100 md:my-0 md:p-0.5" title="Retirer" aria-label="Retirer cette session">
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Commentaires et mentions ------------------------------------------------


const escapeText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Corps d'un commentaire : HTML assaini (serveur / modèle local ; anciens
 * commentaires en texte brut convertis) dont les mentions `@[Nom](id)`
 * deviennent des pastilles « @Nom ».
 */
function CommentBody({ body, members }: { body: string; members: MemberDto[] }) {
  const html = editorHtml(body).replace(/@\[([^\]<\n]+)\](?:\(([A-Za-z0-9_-]+)\))?/g, (_w, name: string, id?: string) => {
    const member = members.find((x) => x.id === id) ?? members.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return member ? `<span class="rounded bg-brand-50 px-1 font-medium text-brand-700">@${escapeText(member.name)}</span>` : `@${name}`;
  });
  // Contenu assaini par le serveur (sanitizeNotes, richHtml) et par le modèle local de l'application.
  return <div className="prose prose-sm max-w-none text-ink-2 [&_p]:my-1" dangerouslySetInnerHTML={{ __html: html }} />;
}

type CommentTree = TaskCommentDto & { replies: CommentTree[] };

function buildTree(comments: TaskCommentDto[]): CommentTree[] {
  const nodes = new Map<string, CommentTree>(comments.map((c) => [c.id, { ...c, replies: [] }]));
  const roots: CommentTree[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.replies.push(n);
    else roots.push(n);
  }
  return roots;
}

/** Zone de saisie riche avec mentions « @ » ; sert au commentaire racine comme aux réponses. */
function CommentComposer({
  task,
  parentId,
  onPosted,
  onCancel,
  autoFocus = false,
  placeholder,
}: {
  task: TaskDetailDto;
  parentId?: string;
  onPosted: (t: TaskDetailDto) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // Change à chaque envoi : l'éditeur repart vide.
  const [round, setRound] = useState(0);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const members = task.project?.members ?? [];
  const empty = !hasHtmlContent(body);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const html = bodyRef.current;
    if (!hasHtmlContent(html) || busy) return;
    setBusy(true);
    try {
      const { task: updated } = await api.post<TaskResp>(`/tasks/${task.id}/comments`, { body: html, parentId: parentId ?? null });
      onPosted(updated);
      setBody("");
      setRound((r) => r + 1);
    } catch (err) {
      toast(errorMessage(err, "Envoi impossible."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      <RichTextEditor
        initialHtml=""
        documentKey={`${task.id}:${parentId ?? "root"}:${round}`}
        variant="compact"
        minHeight={parentId ? 48 : 72}
        autoFocus={autoFocus}
        mentions={members.map((m) => ({ id: m.id, name: m.name, color: m.color, avatarUrl: m.avatarUrl }))}
        placeholder={placeholder ?? "Écrire un commentaire… « @ » pour mentionner quelqu'un, Ctrl+Entrée pour envoyer."}
        onChange={setBody}
        onSubmit={() => void submit()}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size={parentId ? "sm" : "md"} onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" size={parentId ? "sm" : "md"} disabled={busy || empty}>
          <Send className="h-4 w-4" /> {parentId ? "Répondre" : "Envoyer"}
        </Button>
      </div>
    </form>
  );
}

function CommentNode({
  node,
  depth,
  task,
  currentUserId,
  isOwner,
  onChange,
  highlightId,
}: {
  node: CommentTree;
  depth: number;
  task: TaskDetailDto;
  currentUserId: string;
  isOwner: boolean;
  onChange: (t: TaskDetailDto) => void;
  highlightId: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const count = countReplies(node);

  async function remove() {
    const extra = count > 0 ? ` et ses ${count} réponse${count > 1 ? "s" : ""}` : "";
    if (!confirm(`Supprimer ce commentaire${extra} ?`)) return;
    try {
      const { task: updated } = await api.delete<TaskResp>(`/comments/${node.id}`);
      onChange(updated);
    } catch (e) {
      toast(errorMessage(e, "Suppression impossible."), "error");
    }
  }

  return (
    <li id={`comment-${node.id}`} className={depth > 0 ? "mt-3" : ""}>
      <div className="flex gap-2 sm:gap-3">
        <Avatar id={node.authorId} name={node.authorName} src={node.authorAvatarUrl} size={depth === 0 ? 32 : 26} />
        <div className="min-w-0 flex-1">
          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 ${highlightId === node.id ? "bg-amber-50 ring-2 ring-amber-200" : "bg-surface-2"}`}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-ink">{node.authorName}</span>
              <span>·</span>
              <span>{new Date(node.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
              {(node.authorId === currentUserId || isOwner) && (
                <button type="button" onClick={remove} className="-my-1 ml-auto rounded p-1.5 text-faint hover:bg-surface-3 hover:text-danger md:my-0 md:p-1" title="Supprimer" aria-label="Supprimer ce commentaire">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1">
              <CommentBody body={node.body} members={(task.project?.members ?? [])} />
            </div>
          </div>
          <div className="mt-1 flex items-center gap-3 pl-2 text-xs">
            <button type="button" onClick={() => setReplying((v) => !v)} className="flex items-center gap-1 font-medium text-brand-700 hover:underline">
              <CornerDownRight className="h-3.5 w-3.5" /> Répondre
            </button>
            {count > 0 && (
              <button type="button" onClick={() => setCollapsed((v) => !v)} className="text-muted hover:text-ink">
                {collapsed ? `Afficher ${count} réponse${count > 1 ? "s" : ""}` : `Masquer les réponses`}
              </button>
            )}
          </div>
          {replying && (
            <div className="mt-2">
              <CommentComposer
                task={task}
                parentId={node.id}
                autoFocus
                placeholder={`Répondre à ${node.authorName}…`}
                onPosted={(t) => {
                  onChange(t);
                  setReplying(false);
                }}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
          {!collapsed && node.replies.length > 0 && (
            // Profondeur illimitée : l'indentation s'arrête visuellement au 4e niveau
            // pour rester lisible sur mobile (une bordure gauche marque le fil).
            <ul className={`border-l-2 border-line ${depth < 3 ? "ml-1 pl-3 sm:ml-2 sm:pl-4" : "ml-0 pl-2"}`}>
              {node.replies.map((r) => (
                <CommentNode key={r.id} node={r} depth={depth + 1} task={task} currentUserId={currentUserId} isOwner={isOwner} onChange={onChange} highlightId={highlightId} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function countReplies(n: CommentTree): number {
  return n.replies.reduce((a, r) => a + 1 + countReplies(r), 0);
}

function Comments({ task, currentUserId, isOwner, onChange }: { task: TaskDetailDto; currentUserId: string; isOwner: boolean; onChange: (t: TaskDetailDto) => void }) {
  const tree = useMemo(() => buildTree(task.comments), [task.comments]);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Lien depuis une notification : #comment-<id> → défilement et mise en évidence.
  useEffect(() => {
    const m = /^#comment-(.+)$/.exec(window.location.hash);
    if (!m) return;
    setHighlightId(m[1]);
    const el = document.getElementById(`comment-${m[1]}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <MessageSquare className="h-5 w-5 text-brand-600" /> Échanges
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{task.comments.length}</span>
      </h2>

      {tree.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucun commentaire. Lancez la discussion ci-dessous ; tapez « @ » pour mentionner un membre de l&apos;équipe. Chaque commentaire peut recevoir des réponses, et chaque réponse aussi.</p>
      ) : (
        <ul className="mt-4 space-y-5">
          {tree.map((c) => (
            <CommentNode key={c.id} node={c} depth={0} task={task} currentUserId={currentUserId} isOwner={isOwner} onChange={onChange} highlightId={highlightId} />
          ))}
        </ul>
      )}

      <div className="mt-5">
        <CommentComposer task={task} onPosted={onChange} />
      </div>
    </section>
  );
}
