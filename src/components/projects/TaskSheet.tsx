"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarDays, CalendarPlus, Check, Circle, CircleDot, CornerDownRight, Eye, Flag, FolderKanban, Gauge, Layers, Lock, MessageSquare, Plus, Send, Trash2, Unlink, User, Users, Workflow, X } from "lucide-react";
import { api } from "@/lib/client";
import type { MemberDto, ProjectDto, ProjectSummary, TaskMutation } from "@/lib/projects";
import type { TaskCommentDto, TaskDetailDto, WorkSessionDto } from "@/lib/tasks";
import type { NodeTasksResult } from "@/lib/tasks";
import { NotesPreview } from "@/components/notes/NotesPreview";
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
  selectClass,
  toInputDate,
  todayYmd,
} from "@/components/ui";

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
        alert(e instanceof Error ? e.message : "Erreur");
        await reload().catch(() => {});
      } finally {
        setSaving((s) => s - 1);
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
        <span className={`ml-auto text-xs ${saving ? "text-warn" : "text-faint"}`}>{saving ? "Enregistrement…" : "Enregistré"}</span>
      </div>

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
          <div className="mt-5 flex items-center gap-3">
            <div className="flex flex-wrap gap-1">
              {(["TODO", "IN_PROGRESS", "DONE"] as const).map((s) => (
                <button
                  key={s}
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
                  onClick={() => patch({ status: task.status === "CLOSED" ? "DONE" : "CLOSED" })}
                  title={task.status === "CLOSED" ? "Rouvrir (revient à Terminée)" : "Clôturer : la tâche sort du flux courant"}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${
                    task.status === "CLOSED" ? "bg-violet-600 text-white ring-violet-600" : "bg-surface text-violet-700 ring-violet-200 hover:bg-violet-50"
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
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => onProgress(Number(e.target.value))} className="w-36 accent-brand-600" title="Avancement" />
          </div>

          {/* Champs */}
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field icon={<Flag className="h-4 w-4" />} label="Priorité">
              <select value={task.priority} onChange={(e) => patch({ priority: e.target.value })} className={`${selectClass} w-full`}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field icon={<Gauge className="h-4 w-4" />} label="Complexité">
              <select value={task.complexity} onChange={(e) => patch({ complexity: e.target.value })} className={`${selectClass} w-full`}>
                {COMPLEXITIES.map((c) => (
                  <option key={c} value={c}>
                    {COMPLEXITY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field icon={<User className="h-4 w-4" />} label="Responsable">
              <div className="flex items-center gap-2">
                {task.assignee && <Avatar id={task.assignee.id} name={task.assignee.name} color={task.assignee.color} src={task.assignee.avatarUrl} size={26} />}
                <select value={task.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} disabled={!task.project} title={task.project ? undefined : "Rattachez la tâche à un projet pour l'affecter à un membre"} className={`${selectClass} min-w-0 flex-1 disabled:opacity-50`}>
                  <option value="">— Personne —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.role ? ` (${m.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field icon={<Eye className="h-4 w-4" />} label="Superviseur">
              <div className="flex items-center gap-2">
                {task.supervisor && <Avatar id={task.supervisor.id} name={task.supervisor.name} color={task.supervisor.color} src={task.supervisor.avatarUrl} size={26} />}
                <select value={task.supervisorId ?? ""} onChange={(e) => patch({ supervisorId: e.target.value || null })} disabled={!task.project} title={task.project ? "Une seule personne supervise la tâche" : "Rattachez la tâche à un projet"} className={`${selectClass} min-w-0 flex-1 disabled:opacity-50`}>
                  <option value="">— Personne —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.role ? ` (${m.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field icon={<Users className="h-4 w-4" />} label="Contributeurs">
              <MemberMultiSelect members={members} value={task.contributorIds} disabled={!task.project} onChange={(contributorIds) => patch({ contributorIds })} />
            </Field>
            <Field icon={<CalendarDays className="h-4 w-4" />} label="Début">
              <input type="date" value={toInputDate(task.startDate)} onChange={(e) => patch({ startDate: e.target.value || null })} className={`${selectClass} w-full`} />
            </Field>
            <Field icon={<CalendarDays className="h-4 w-4" />} label="Échéance">
              <input type="date" value={toInputDate(task.dueDate)} onChange={(e) => patch({ dueDate: e.target.value || null })} className={`${selectClass} w-full ${late ? "border-red-300 text-danger" : ""}`} />
            </Field>
          </dl>

          {/* Rattachement : projet › étape › activité, tous facultatifs */}
          <AttachmentBlock task={task} patch={patch} />

          {/* Nœuds de carte mentale */}
          <NodeLinks task={task} onChange={(nodes) => setTask((t) => ({ ...t, nodes }))} />

          {/* Notes riches (éditées dans « Prise de notes ») */}
          <NotesPreview html={task.notes} noteRef={`task:${task.id}`} className="mt-4 !rounded-xl !bg-surface-2/60 !p-3" />

          {/* Sessions de travail planifiées */}
          <WorkSessions task={task} onChange={(workSessions) => setTask((t) => ({ ...t, workSessions }))} />

          <div className="mt-6">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Description</h2>
            <InlineEdit
              value={task.description}
              onSave={(description) => patch({ description })}
              as="div"
              multiline
              placeholder="Décrire la tâche, le résultat attendu, les points d'attention…"
              className="-mx-1.5 block min-h-12 whitespace-pre-wrap text-sm leading-relaxed text-ink-2"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">
            <span>Dernière modification : {formatDate(task.updatedAt)}</span>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return;
                await api.delete(`/tasks/${task.id}`);
                router.push(backHref);
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer la tâche
            </Button>
          </div>
        </div>
      </div>

      {/* Commentaires */}
      <Comments task={task} currentUserId={currentUserId} isOwner={isOwner} onChange={setTask} />
      </fieldset>
    </div>
  );
}

/** Sélection multiple de membres (cases à cocher), pour les contributeurs. */
function MemberMultiSelect({ members, value, disabled, onChange }: { members: MemberDto[]; value: string[]; disabled?: boolean; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const selected = members.filter((m) => value.includes(m.id));
  if (disabled) return <p className="text-xs text-muted">Rattachez la tâche à un projet pour choisir des contributeurs.</p>;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${selectClass} flex w-full items-center gap-1 text-left`} aria-expanded={open}>
        {selected.length === 0 ? (
          <span className="text-muted">— Personne —</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selected.map((m) => (
              <span key={m.id} className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs">
                <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={18} /> {m.name}
              </span>
            ))}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{selected.length}/{members.length}</span>
      </button>
      {open && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {members.map((m) => {
            const checked = value.includes(m.id);
            return (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((id) => id !== m.id) : [...value, m.id])} className="accent-brand-600" />
                  <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.role && <span className="text-xs text-muted">{m.role}</span>}
                </label>
              </li>
            );
          })}
          <li className="border-t border-line p-1 text-right">
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">
              Fermer
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 p-3">
      <dt className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon} {label}
      </dt>
      <dd>{children}</dd>
    </div>
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
    <div className="mt-4 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <FolderKanban className="h-4 w-4" /> Rattachement
        <span className="font-normal text-faint">— projet, étape et activité sont facultatifs</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Projet</span>
          <select value={task.project?.id ?? ""} onChange={(e) => patch({ projectId: e.target.value || null })} className={`${selectClass} w-full`}>
            <option value="">Sans projet</option>
            {(projects ?? (task.project ? [{ id: task.project.id, name: task.project.name }] : [])).map((p) => (
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
    await api.delete<NodeTasksResult>(`/mindmaps/${n.mapId}/nodes/${n.id}/tasks/${task.id}`);
    onChange(task.nodes.filter((x) => x.id !== n.id));
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
            <button type="button" onClick={() => unlink(n)} className="rounded p-0.5 text-faint hover:bg-red-50 hover:text-danger" title="Détacher de ce nœud">
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
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: WorkSessionDto) {
    const { sessions } = await api.delete<{ sessions: WorkSessionDto[] }>(`/sessions/${s.id}`);
    onChange(sessions);
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
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${selectClass} py-1 text-xs`} />
          <Button size="sm" variant="outline" onClick={add} disabled={busy || !date}>
            <Plus className="h-3.5 w-3.5" /> Planifier
          </Button>
        </div>
      </div>
      {task.workSessions.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Aucune session planifiée. Choisissez un jour ci-dessus, ou glissez la tâche sur le calendrier dans{" "}
          <Link href="/organize#calendar" className="text-brand-700 hover:underline">
            Organiser mes tâches
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {task.workSessions.map((s) => (
            <li
              key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${s.late ? "border-red-400 bg-red-50 text-red-800" : "border-line bg-surface text-ink-2"}`}
              title={s.late ? "Cette session est après l'échéance de la tâche" : undefined}
            >
              {s.late && <AlertTriangle className="h-3.5 w-3.5" />}
              <CalendarDays className="h-3.5 w-3.5 opacity-60" />
              <span className="font-medium">{new Date(`${s.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>
              {!s.mine && <span className="text-muted">· {s.userName}</span>}
              {s.mine && (
                <button type="button" onClick={() => remove(s)} className="rounded p-0.5 opacity-50 hover:bg-surface-3 hover:opacity-100" title="Retirer">
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

/** `@[Nom](memberId)` (forme stockée) ou `@[Nom]` (forme saisie). */
const MENTION_RE = /@\[([^\]]+)\](?:\(([A-Za-z0-9_-]+)\))?/g;

/** Rend un corps de commentaire en surlignant les mentions. */
function CommentBody({ body, members }: { body: string; members: MemberDto[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(body.slice(last, idx));
    const member = members.find((x) => x.id === m[2]) ?? members.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    parts.push(
      member ? (
        <span key={idx} className="rounded bg-brand-50 px-1 font-medium text-brand-700" title={member.role ?? undefined}>
          @{member.name}
        </span>
      ) : (
        // Mention sans membre correspondant : texte simple, pas de lien.
        <span key={idx}>@{m[1]}</span>
      ),
    );
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{parts}</p>;
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

/** Zone de saisie avec mentions « @ » ; sert au commentaire racine comme aux réponses. */
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return (task.project?.members ?? []).filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, (task.project?.members ?? [])]);

  /** Détecte un « @mot » en cours de saisie avant le curseur. */
  function detectMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@\[\]]*)$/.exec(before);
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
      setHighlight(0);
    } else setMention(null);
  }

  function insertMention(member: MemberDto) {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    // Dans la zone de saisie, seule la forme lisible `@[Nom]` apparaît ;
    // le serveur résout l'identifiant du membre à l'envoi.
    const token = `@[${member.name}] `;
    const next = body.slice(0, mention.start) + token + body.slice(caret);
    setBody(next);
    setMention(null);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const pos = mention.start + token.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const { task: updated } = await api.post<TaskResp>(`/tasks/${task.id}/comments`, { body: text, parentId: parentId ?? null });
      onPosted(updated);
      setBody("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={body}
        rows={parentId ? 2 : 3}
        placeholder={placeholder ?? "Écrire un commentaire… « @ » pour mentionner quelqu'un, Ctrl+Entrée pour envoyer."}
        onChange={(e) => {
          setBody(e.target.value);
          detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (mention && candidates.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % candidates.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insertMention(candidates[highlight]);
              return;
            }
            if (e.key === "Escape") {
              setMention(null);
              return;
            }
          }
          if (e.key === "Escape" && onCancel) onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        onClick={(e) => detectMention(body, (e.target as HTMLTextAreaElement).selectionStart ?? body.length)}
        className="w-full resize-y rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {mention && candidates.length > 0 && (
        <ul className="absolute bottom-full left-0 z-10 mb-1 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {candidates.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(m)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === highlight ? "bg-brand-50" : "hover:bg-surface-2"}`}
              >
                <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={24} />
                <span className="font-medium">{m.name}</span>
                {m.role && <span className="text-xs text-muted">{m.role}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size={parentId ? "sm" : "md"} onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" size={parentId ? "sm" : "md"} disabled={busy || !body.trim()}>
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
    const { task: updated } = await api.delete<TaskResp>(`/comments/${node.id}`);
    onChange(updated);
  }

  return (
    <li id={`comment-${node.id}`} className={depth > 0 ? "mt-3" : ""}>
      <div className="flex gap-2 sm:gap-3">
        <Avatar id={node.authorId} name={node.authorName} src={node.authorAvatarUrl} size={depth === 0 ? 32 : 26} />
        <div className="min-w-0 flex-1">
          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 ${highlightId === node.id ? "bg-amber-50 ring-2 ring-amber-300" : "bg-surface-2"}`}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-ink">{node.authorName}</span>
              <span>·</span>
              <span>{new Date(node.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
              {(node.authorId === currentUserId || isOwner) && (
                <button onClick={remove} className="ml-auto rounded p-1 text-faint hover:bg-surface-3 hover:text-danger" title="Supprimer">
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
