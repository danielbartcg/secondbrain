"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Circle, CircleDot, ExternalLink, Inbox, Lock, Trash2 } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { api } from "@/lib/client";
import type { TaskDto, TaskMutation } from "@/lib/projects";
import { Badge, PRIORITY_LABEL, PRIORITY_TONE, PriorityFlag, QuickAdd, TASK_STATUS_LABEL, formatDate, isFinished } from "@/components/ui";

/**
 * Projet virtuel « Sans projet » : mes tâches orphelines (ni projet, ni
 * étape). Création rapide, changement de statut, accès à la fiche (où la
 * tâche peut être rattachée à un projet), suppression.
 */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { TODO: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "TODO", CLOSED: "TODO" };

export function OrphanTasks({ initial }: { initial: TaskDto[] }) {
  const [tasks, setTasks] = useState(initial);
  const [showClosed, setShowClosed] = useState(false);

  const reload = async () => {
    const { tasks } = await api.get<{ tasks: TaskDto[] }>("/tasks");
    setTasks(tasks);
  };
  const patch = async (id: string, data: Record<string, unknown>) => {
    try {
      const { task } = await api.patch<TaskMutation>(`/tasks/${id}`, data);
      if (task) setTasks((ts) => ts.map((t) => (t.id === id ? task : t)));
      else await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur");
      await reload();
    }
  };
  const remove = async (t: TaskDto) => {
    if (!confirm(`Supprimer la tâche « ${t.name} » ?`)) return;
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    await api.delete(`/tasks/${t.id}`).catch(reload);
  };

  const visible = tasks.filter((t) => showClosed || t.status !== "CLOSED");
  const open = tasks.filter((t) => !isFinished(t.status)).length;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">
        <Link href="/projects" className="flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Projets
        </Link>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2">
            <Inbox className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Sans projet</h1>
            <p className="mt-1 text-sm text-muted">
              Vos tâches qui ne sont rattachées à aucun projet. Elles remontent dans vos tableaux de bord et dans « Organiser mes tâches » ; depuis leur fiche, vous pouvez les rattacher à un projet, une étape ou une activité.
            </p>
          </div>
        </div>
        <QuickAdd
          className="mt-4"
          placeholder="Nouvelle tâche sans projet (Entrée pour créer)"
          onAdd={async (name) => {
            const { task } = await api.post<TaskMutation>("/tasks", { name });
            if (task) setTasks((ts) => [...ts, task]);
          }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          {open} ouverte{open > 1 ? "s" : ""} · {tasks.length} au total
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-brand-600" /> Afficher les clôturées
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">Aucune tâche ici.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
          {visible.map((t) => {
            const done = isFinished(t.status);
            const closed = t.status === "CLOSED";
            const late = t.dueDate && !done && new Date(t.dueDate) < new Date();
            return (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => patch(t.id, { status: NEXT_STATUS[t.status] })}
                  title={`Statut : ${TASK_STATUS_LABEL[t.status]} (cliquer pour changer)`}
                  className={`shrink-0 rounded-full ${closed ? "text-violet-600" : done ? "text-ok" : t.status === "IN_PROGRESS" ? "text-brand-600" : "text-faint"}`}
                >
                  {closed ? <Lock className="h-5 w-5" /> : done ? <Check className="h-5 w-5" /> : t.status === "IN_PROGRESS" ? <CircleDot className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                </button>
                <PriorityFlag priority={t.priority} />
                <Link href={`/tasks/${t.id}`} className={`min-w-0 flex-1 truncate text-sm hover:underline ${done ? "text-muted line-through" : ""}`}>
                  {t.name}
                </Link>
                <Badge tone={PRIORITY_TONE[t.priority]} className="hidden sm:inline-flex">
                  {PRIORITY_LABEL[t.priority]}
                </Badge>
                {t.dueDate && <span className={`hidden shrink-0 text-xs md:inline ${late ? "text-danger" : "text-muted"}`}>{formatDate(t.dueDate)}</span>}
                <span className="hidden w-10 text-right text-xs tabular-nums text-ink-2 sm:inline">{t.progress}%</span>
                <Link href={`/tasks/${t.id}`} className="rounded p-1 text-muted hover:bg-surface-2" title="Ouvrir la fiche tâche">
                  <ExternalLink className="h-4 w-4" />
                </Link>
                <button onClick={() => remove(t)} className="rounded p-1 text-faint hover:bg-red-50 hover:text-danger" title="Supprimer">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
