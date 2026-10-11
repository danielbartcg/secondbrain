"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Check, ChevronDown, ChevronRight, Circle, CircleDot, Layers, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { ActivityDto, ProjectDto, StageDto, TaskDto } from "@/lib/projects";
import type { TaskStatus } from "@prisma/client";
import { Button, InlineEdit, ProgressBar, QuickAdd, formatDate, toInputDate } from "@/components/ui";
import { STATUS_LABEL } from "./ProjectList";

/**
 * Tableau de bord d'un projet : étapes › activités (facultatives) › tâches.
 * Toute mutation renvoie le projet recalculé par l'API (avancements agrégés) :
 * l'état local est simplement remplacé par la réponse.
 */

type Resp = { project: ProjectDto };
const COLORS = ["#4f5ff0", "#1f9d55", "#d98a0b", "#d13b3b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b"];

export function ProjectBoard({ initial }: { initial: ProjectDto }) {
  const [project, setProject] = useState(initial);
  const [saving, setSaving] = useState(0);
  const [showAddStage, setShowAddStage] = useState(initial.stages.length === 0);

  const run = useCallback(async (fn: () => Promise<Resp>) => {
    setSaving((s) => s + 1);
    try {
      const { project } = await fn();
      setProject(project);
    } catch (e) {
      console.error(e);
      const { project } = await api.get<Resp>(`/projects/${initial.id}`).catch(() => ({ project: null }));
      if (project) setProject(project);
    } finally {
      setSaving((s) => s - 1);
    }
  }, [initial.id]);

  const patchProject = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/projects/${project.id}`, data));

  return (
    <div>
      {/* En-tête du projet */}
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">
        <Link href="/projects" className="flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Projets
        </Link>
        <span className={`ml-auto text-xs ${saving ? "text-warn" : "text-faint"}`}>{saving ? "Enregistrement…" : "Enregistré"}</span>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-1" title="Couleur">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => patchProject({ color: c })}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full ${project.color === c ? "ring-2 ring-brand-500 ring-offset-1" : "opacity-60 hover:opacity-100"}`}
              />
            ))}
          </div>
          <select
            value={project.status}
            onChange={(e) => patchProject({ status: e.target.value })}
            className="ml-auto rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs font-medium"
          >
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <InlineEdit value={project.name} onSave={(name) => patchProject({ name })} as="h1" className="-mx-1.5 mt-2 block text-2xl font-semibold tracking-tight" />
        <InlineEdit
          value={project.description}
          onSave={(description) => patchProject({ description })}
          as="div"
          multiline
          placeholder="Ajouter une description…"
          className="-mx-1.5 mt-1 block whitespace-pre-wrap text-sm text-ink-2"
        />
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <DateField label="Début" value={project.startDate} onChange={(v) => patchProject({ startDate: v })} />
          <DateField label="Échéance" value={project.dueDate} onChange={(v) => patchProject({ dueDate: v })} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <ProgressBar percent={project.progress.percent} color={project.color} className="h-3" />
          <span className="shrink-0 text-sm font-semibold tabular-nums">{project.progress.percent}%</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {project.progress.done}/{project.progress.total} tâche{project.progress.total > 1 ? "s" : ""} terminée{project.progress.done > 1 ? "s" : ""} ·{" "}
          {project.stages.length} étape{project.stages.length > 1 ? "s" : ""}
        </p>
      </div>

      {/* Étapes */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Layers className="h-5 w-5 text-brand-600" /> Étapes
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowAddStage((v) => !v)}>
          <Plus className="h-4 w-4" /> Étape
        </Button>
      </div>
      {showAddStage && (
        <QuickAdd
          autoFocus
          className="mt-3"
          placeholder="Nom de l'étape (ex. Cadrage, Conception, Réalisation…)"
          onAdd={async (name) => {
            await run(() => api.post<Resp>(`/projects/${project.id}/stages`, { name }));
          }}
        />
      )}

      <div className="mt-3 space-y-3">
        {project.stages.map((stage, i) => (
          <StageCard key={stage.id} stage={stage} index={i} count={project.stages.length} color={project.color} run={run} />
        ))}
        {project.stages.length === 0 && !showAddStage && (
          <p className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">Aucune étape : commencez par en ajouter une.</p>
        )}
      </div>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-muted">
      <CalendarDays className="h-4 w-4" />
      <span>{label}</span>
      <input
        type="date"
        value={toInputDate(value)}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
      />
    </label>
  );
}

type Run = (fn: () => Promise<Resp>) => Promise<void>;

function StageCard({ stage, index, count, color, run }: { stage: StageDto; index: number; count: number; color: string | null; run: Run }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState<"task" | "activity" | null>(null);
  const patch = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/stages/${stage.id}`, data));
  const total = stage.activities.reduce((a, x) => a + x.tasks.length, 0) + stage.tasks.length;

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex items-start gap-2 p-3 sm:p-4">
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-2" title={open ? "Replier" : "Déplier"}>
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Étape {index + 1}</span>
            <InlineEdit value={stage.name} onSave={(name) => patch({ name })} as="h3" className="-mx-1.5 font-semibold" />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <ProgressBar percent={stage.progress.percent} color={color} />
            <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">
              {stage.progress.percent}% · {stage.progress.done}/{total}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <DateField label="Début" value={stage.startDate} onChange={(v) => patch({ startDate: v })} />
            <DateField label="Échéance" value={stage.dueDate} onChange={(v) => patch({ dueDate: v })} />
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <IconBtn title="Monter" disabled={index === 0} onClick={() => patch({ order: index - 1 })}>
            <ArrowUp className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Descendre" disabled={index === count - 1} onClick={() => patch({ order: index + 1 })}>
            <ArrowDown className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title="Supprimer l'étape"
            danger
            onClick={() => {
              if (confirm(`Supprimer l'étape « ${stage.name} » et tout son contenu ?`)) void run(() => api.delete<Resp>(`/stages/${stage.id}`));
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </header>

      {open && (
        <div className="border-t border-line px-3 pb-3 sm:px-4 sm:pb-4">
          {stage.activities.map((activity, ai) => (
            <ActivityBlock key={activity.id} activity={activity} index={ai} count={stage.activities.length} color={color} run={run} />
          ))}

          {stage.tasks.length > 0 && (
            <div className="mt-3">
              {stage.activities.length > 0 && <p className="mb-1 text-xs font-medium text-muted">Tâches directes de l&apos;étape</p>}
              <TaskList tasks={stage.tasks} run={run} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(adding === "task" ? null : "task")}>
              <Plus className="h-4 w-4" /> Tâche
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(adding === "activity" ? null : "activity")}>
              <Plus className="h-4 w-4" /> Activité
            </Button>
          </div>
          {adding === "task" && (
            <QuickAdd
              autoFocus
              className="mt-2"
              placeholder="Nouvelle tâche rattachée à l'étape"
              onAdd={async (name) => {
                await run(() => api.post<Resp>(`/stages/${stage.id}/tasks`, { name }));
              }}
            />
          )}
          {adding === "activity" && (
            <QuickAdd
              autoFocus
              className="mt-2"
              placeholder="Nouvelle activité (regroupe des tâches)"
              onAdd={async (name) => {
                await run(() => api.post<Resp>(`/stages/${stage.id}/activities`, { name }));
                setAdding(null);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ActivityBlock({ activity, index, count, color, run }: { activity: ActivityDto; index: number; count: number; color: string | null; run: Run }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const patch = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/activities/${activity.id}`, data));

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-start gap-2">
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-3">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Activité</span>
            <InlineEdit value={activity.name} onSave={(name) => patch({ name })} as="h4" className="-mx-1.5 text-sm font-medium" />
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <ProgressBar percent={activity.progress.percent} color={color} className="h-1.5" />
            <span className="shrink-0 text-[11px] tabular-nums text-muted">
              {activity.progress.percent}% · {activity.progress.done}/{activity.tasks.length}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <IconBtn title="Monter" disabled={index === 0} onClick={() => patch({ order: index - 1 })}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Descendre" disabled={index === count - 1} onClick={() => patch({ order: index + 1 })}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            title="Supprimer l'activité"
            danger
            onClick={() => {
              if (confirm(`Supprimer l'activité « ${activity.name} » et ses tâches ?`)) void run(() => api.delete<Resp>(`/activities/${activity.id}`));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>
      {open && (
        <div className="mt-2 pl-6">
          <TaskList tasks={activity.tasks} run={run} />
          {adding ? (
            <QuickAdd
              autoFocus
              className="mt-2"
              placeholder="Nouvelle tâche"
              onAdd={async (name) => {
                await run(() => api.post<Resp>(`/activities/${activity.id}/tasks`, { name }));
              }}
            />
          ) : (
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Tâche
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TaskList({ tasks, run }: { tasks: TaskDto[]; run: Run }) {
  if (tasks.length === 0) return null;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {tasks.map((t, i) => (
        <TaskRow key={t.id} task={t} index={i} count={tasks.length} run={run} />
      ))}
    </ul>
  );
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { TODO: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "TODO" };

function TaskRow({ task, index, count, run }: { task: TaskDto; index: number; count: number; run: Run }) {
  const [progress, setProgress] = useState(task.progress);
  const [open, setOpen] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Le curseur envoie sa valeur 400 ms après le dernier mouvement. */
  const onProgress = (value: number) => {
    setProgress(value);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      if (value !== task.progress) void patch({ progress: value });
    }, 400);
  };
  // Resynchronise le curseur quand le serveur renvoie une nouvelle valeur.
  const [lastServer, setLastServer] = useState(task.progress);
  if (task.progress !== lastServer) {
    setLastServer(task.progress);
    setProgress(task.progress);
  }
  const patch = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/tasks/${task.id}`, data));
  const done = task.status === "DONE";

  return (
    <li className="px-2 py-2 sm:px-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => patch({ status: NEXT_STATUS[task.status] })}
          title={`Statut : ${task.status === "TODO" ? "À faire" : task.status === "IN_PROGRESS" ? "En cours" : "Terminée"} (cliquer pour changer)`}
          className={`shrink-0 rounded-full ${done ? "text-ok" : task.status === "IN_PROGRESS" ? "text-brand-600" : "text-faint"}`}
        >
          {done ? <Check className="h-5 w-5" /> : task.status === "IN_PROGRESS" ? <CircleDot className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
        </button>
        <InlineEdit
          value={task.name}
          onSave={(name) => patch({ name })}
          className={`-mx-1.5 min-w-0 flex-1 text-sm ${done ? "text-muted line-through" : ""}`}
        />
        <div className="hidden items-center gap-2 sm:flex">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => onProgress(Number(e.target.value))}
            className="w-28 accent-brand-600"
            title="Avancement"
          />
          <span className="w-9 text-right text-xs tabular-nums text-ink-2">{progress}%</span>
        </div>
        {task.dueDate && (
          <span className={`hidden shrink-0 text-xs md:inline ${!done && new Date(task.dueDate) < new Date() ? "text-danger" : "text-muted"}`}>
            {formatDate(task.dueDate)}
          </span>
        )}
        <button onClick={() => setOpen((v) => !v)} className="rounded p-1 text-muted hover:bg-surface-2" title="Détails">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Avancement visible sur mobile */}
      <div className="mt-1.5 flex items-center gap-2 pl-7 sm:hidden">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={progress}
          onChange={(e) => onProgress(Number(e.target.value))}
          className="flex-1 accent-brand-600"
        />
        <span className="w-9 text-right text-xs tabular-nums text-ink-2">{progress}%</span>
      </div>

      {open && (
        <div className="mt-2 space-y-2 pl-7 text-sm">
          <InlineEdit
            value={task.description}
            onSave={(description) => patch({ description })}
            as="div"
            multiline
            placeholder="Ajouter une description…"
            className="-mx-1.5 block whitespace-pre-wrap text-ink-2"
          />
          <div className="flex flex-wrap items-center gap-3">
            <DateField label="Échéance" value={task.dueDate} onChange={(v) => patch({ dueDate: v })} />
            <div className="ml-auto flex items-center">
              <IconBtn title="Monter" disabled={index === 0} onClick={() => patch({ order: index - 1 })}>
                <ArrowUp className="h-4 w-4" />
              </IconBtn>
              <IconBtn title="Descendre" disabled={index === count - 1} onClick={() => patch({ order: index + 1 })}>
                <ArrowDown className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                title="Supprimer la tâche"
                danger
                onClick={() => {
                  if (confirm(`Supprimer la tâche « ${task.name} » ?`)) void run(() => api.delete<Resp>(`/tasks/${task.id}`));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function IconBtn({ title, onClick, disabled, danger, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-1.5 disabled:opacity-30 ${danger ? "text-faint hover:bg-red-50 hover:text-danger" : "text-muted hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
