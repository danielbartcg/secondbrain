"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Link2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import type { TaskDetailDto } from "@/lib/tasks";
import { prerequisiteError } from "@/lib/shared/prerequisites";
import { Badge, TASK_STATUS_LABEL, TASK_STATUS_TONE, formatDate, isFinished, selectClass } from "@/components/ui";

/** Toutes les tâches d'un projet (étapes, activités, sans étape). */
export function projectTasks(p: ProjectDto): TaskDto[] {
  return [...p.tasks, ...p.stages.flatMap((s) => [...s.tasks, ...s.activities.flatMap((a) => a.tasks)])];
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * Prérequis d'une tâche (fiche tâche, bloc Calendrier) : liste des tâches dont
 * elle dépend, alerte si un prérequis finit après son début ou n'est pas
 * terminé, ajout (tâches du même projet, sans créer de cycle), retrait, et
 * rappel des tâches qu'elle bloque.
 */
export function PrerequisitesField({ task, disabled, onChange }: { task: TaskDetailDto; disabled?: boolean; onChange: (prerequisiteIds: string[]) => void }) {
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const projectId = task.project?.id;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ project: ProjectDto }>(`/projects/${projectId}`)
      .then((r) => !cancelled && setTasks(projectTasks(r.project)))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, task.updatedAt]);

  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const current = task.prerequisiteIds ?? [];
  const dependents = (tasks ?? []).filter((t) => t.prerequisiteIds?.includes(task.id));
  const eligible = (tasks ?? []).filter((t) => t.id !== task.id && !current.includes(t.id) && !prerequisiteError(task.id, [...current, t.id], tasks ?? []));

  if (!task.project) return <p className="text-xs text-muted">Rattachez la tâche à un projet pour définir des prérequis.</p>;

  const start = day(task.startDate ?? task.dueDate);

  return (
    <div>
      {current.length === 0 ? (
        <p className="text-xs text-muted">Aucun prérequis : la tâche peut démarrer sans attendre.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {current.map((id) => {
            const p = byId.get(id);
            const end = p ? day(p.dueDate ?? p.startDate) : null;
            const late = !!(p && start && end && end > start);
            const open = !!(p && !isFinished(p.status));
            return (
              <li key={id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${late ? "border-danger bg-red-50" : "border-line bg-surface"}`}>
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                {p ? (
                  <Link href={`/tasks/${p.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand-700">
                    {p.name}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-muted">{tasks === null ? "Chargement…" : "Tâche introuvable"}</span>
                )}
                {p && <Badge tone={TASK_STATUS_TONE[p.status]}>{TASK_STATUS_LABEL[p.status]}</Badge>}
                {end && <span className="text-xs text-muted">fin {formatDate(end)}</span>}
                {late && (
                  <span className="flex items-center gap-1 text-xs font-medium text-danger" title="Ce prérequis se termine après le début de la tâche">
                    <AlertTriangle className="h-3.5 w-3.5" /> finit après le début
                  </span>
                )}
                {!late && open && start && <span className="text-xs text-warn">non terminé</span>}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(current.filter((x) => x !== id))}
                    aria-label={`Retirer le prérequis ${p?.name ?? ""}`}
                    title="Retirer"
                    className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger md:p-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && (
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...current, e.target.value])}
          disabled={tasks === null || eligible.length === 0}
          aria-label="Ajouter un prérequis"
          className={`${selectClass} mt-2 w-full disabled:opacity-50 sm:w-auto sm:min-w-64`}
        >
          <option value="">{tasks === null ? "Chargement des tâches…" : eligible.length ? "+ Ajouter un prérequis…" : "Aucune autre tâche disponible"}</option>
          {eligible.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.dueDate ? ` — fin ${formatDate(t.dueDate)}` : ""}
            </option>
          ))}
        </select>
      )}
      {dependents.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          <ArrowRight className="h-3.5 w-3.5" /> Bloque :
          {dependents.map((d, i) => (
            <span key={d.id}>
              <Link href={`/tasks/${d.id}`} className="font-medium text-ink-2 hover:text-brand-700">
                {d.name}
              </Link>
              {i < dependents.length - 1 ? "," : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
