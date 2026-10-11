"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Check, Circle, CircleDot, Flag, Layers, MessageSquare, Send, Trash2, User } from "lucide-react";
import { api } from "@/lib/client";
import type { MemberDto, ProjectDto } from "@/lib/projects";
import type { TaskCommentDto, TaskDetailDto } from "@/lib/tasks";
import { Avatar, Badge, Button, InlineEdit, ProgressBar, TASK_STATUS_LABEL, TASK_STATUS_TONE, formatDate, selectClass, toInputDate } from "@/components/ui";

/**
 * Fiche tâche : champs mis en forme (statut, avancement, responsable, dates,
 * description, rattachement) et fil de commentaires avec mentions « @ ».
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
        await api.patch<{ project: ProjectDto }>(`/tasks/${task.id}`, data);
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

  const late = task.dueDate && task.status !== "DONE" && new Date(task.dueDate) < new Date();
  const color = task.project.color ?? "#4f5ff0";
  const isOwner = task.project.ownerId === currentUserId;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href={`/projects/${task.project.id}#plan`} className="flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {task.project.name}
        </Link>
        <span>/</span>
        <span className="flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> {task.stage.name}
        </span>
        {task.activity && (
          <>
            <span>/</span>
            <span>{task.activity.name}</span>
          </>
        )}
        <span className={`ml-auto text-xs ${saving ? "text-warn" : "text-faint"}`}>{saving ? "Enregistrement…" : "Enregistré"}</span>
      </div>

      {/* Carte principale */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
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
            <div className="flex gap-1">
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
            </div>
            <span className="ml-auto text-lg font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <ProgressBar percent={progress} color={color} className="h-2.5" />
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => onProgress(Number(e.target.value))} className="w-36 accent-brand-600" title="Avancement" />
          </div>

          {/* Champs */}
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field icon={<User className="h-4 w-4" />} label="Responsable">
              <div className="flex items-center gap-2">
                {task.assignee && <Avatar id={task.assignee.id} name={task.assignee.name} color={task.assignee.color} size={26} />}
                <select value={task.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} className={`${selectClass} min-w-0 flex-1`}>
                  <option value="">— Personne —</option>
                  {task.project.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.role ? ` (${m.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field icon={<CalendarDays className="h-4 w-4" />} label="Début">
              <input type="date" value={toInputDate(task.startDate)} onChange={(e) => patch({ startDate: e.target.value || null })} className={`${selectClass} w-full`} />
            </Field>
            <Field icon={<CalendarDays className="h-4 w-4" />} label="Échéance">
              <input type="date" value={toInputDate(task.dueDate)} onChange={(e) => patch({ dueDate: e.target.value || null })} className={`${selectClass} w-full ${late ? "border-red-300 text-danger" : ""}`} />
            </Field>
            <Field icon={<Layers className="h-4 w-4" />} label="Rattachement">
              <select
                value={task.activityId ? `a:${task.activityId}` : `s:${task.stageId}`}
                onChange={(e) => {
                  const [kind, id] = e.target.value.split(":");
                  void patch(kind === "a" ? { activityId: id } : { activityId: null, stageId: id });
                }}
                className={`${selectClass} w-full`}
              >
                <StageOptions task={task} />
              </select>
            </Field>
          </dl>

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
                router.push(`/projects/${task.project.id}#plan`);
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer la tâche
            </Button>
          </div>
        </div>
      </div>

      {/* Commentaires */}
      <Comments task={task} currentUserId={currentUserId} isOwner={isOwner} onChange={setTask} />
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

/** Options « étape » / « étape › activité » : chargées à la demande depuis le projet. */
function StageOptions({ task }: { task: TaskDetailDto }) {
  const [project, setProject] = useState<ProjectDto | null>(null);
  useEffect(() => {
    api
      .get<{ project: ProjectDto }>(`/projects/${task.project.id}`)
      .then(({ project }) => setProject(project))
      .catch(() => {});
  }, [task.project.id]);
  if (!project) {
    return (
      <option value={task.activityId ? `a:${task.activityId}` : `s:${task.stageId}`}>
        {task.stage.name}
        {task.activity ? ` › ${task.activity.name}` : ""}
      </option>
    );
  }
  return (
    <>
      {project.stages.map((s) => (
        <Fragment key={s.id}>
          <option value={`s:${s.id}`}>{s.name}</option>
          {s.activities.map((a) => (
            <option key={a.id} value={`a:${a.id}`}>
              {s.name} › {a.name}
            </option>
          ))}
        </Fragment>
      ))}
    </>
  );
}

// --- Commentaires et mentions ------------------------------------------------

const MENTION_RE = /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g;

/** Rend un corps de commentaire en surlignant les mentions. */
function CommentBody({ body, members }: { body: string; members: MemberDto[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(body.slice(last, idx));
    const member = members.find((x) => x.id === m[2]);
    parts.push(
      <span key={idx} className="rounded bg-brand-50 px-1 font-medium text-brand-700" title={member?.role ?? undefined}>
        @{member?.name ?? m[1]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{parts}</p>;
}

function Comments({ task, currentUserId, isOwner, onChange }: { task: TaskDetailDto; currentUserId: string; isOwner: boolean; onChange: (t: TaskDetailDto) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return task.project.members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, task.project.members]);

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
    const token = `@[${member.name}](${member.id}) `;
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
      const { task: updated } = await api.post<TaskResp>(`/tasks/${task.id}/comments`, { body: text });
      onChange(updated);
      setBody("");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: TaskCommentDto) {
    if (!confirm("Supprimer ce commentaire ?")) return;
    const { task: updated } = await api.delete<TaskResp>(`/comments/${c.id}`);
    onChange(updated);
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <MessageSquare className="h-5 w-5 text-brand-600" /> Échanges
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{task.comments.length}</span>
      </h2>

      {task.comments.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucun commentaire. Lancez la discussion ci-dessous ; tapez « @ » pour mentionner un membre de l&apos;équipe.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {task.comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar id={c.authorId} name={c.authorName} size={32} />
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-ink">{c.authorName}</span>
                  <span>·</span>
                  <span>{new Date(c.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
                  {(c.authorId === currentUserId || isOwner) && (
                    <button onClick={() => remove(c)} className="ml-auto rounded p-1 text-faint hover:bg-surface-3 hover:text-danger" title="Supprimer">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-1">
                  <CommentBody body={c.body} members={task.project.members} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="relative mt-5">
        <textarea
          ref={textareaRef}
          value={body}
          rows={3}
          placeholder="Écrire un commentaire… « @ » pour mentionner quelqu'un, Ctrl+Entrée pour envoyer."
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
                  <Avatar id={m.id} name={m.name} color={m.color} size={24} />
                  <span className="font-medium">{m.name}</span>
                  {m.role && <span className="text-xs text-muted">{m.role}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex justify-end">
          <Button type="submit" disabled={busy || !body.trim()}>
            <Send className="h-4 w-4" /> Envoyer
          </Button>
        </div>
      </form>
    </section>
  );
}
