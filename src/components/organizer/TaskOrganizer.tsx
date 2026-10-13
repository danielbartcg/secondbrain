"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Grid3x3, ListOrdered } from "lucide-react";
import { api } from "@/lib/client";
import type { OrganizerDto, OrganizerTask, WorkSessionDto } from "@/lib/tasks";
import type { TaskMutation } from "@/lib/projects";
import { isFinished } from "@/components/ui";
import { CalendarView } from "./CalendarView";
import { MatrixView } from "./MatrixView";
import { SynthesisView } from "./SynthesisView";

/**
 * « Organiser mes tâches » : trois vues sur mes tâches ouvertes.
 *  - Calendrier : glisser-déposer les tâches sur les jours (sessions de travail) ;
 *  - Sélection : matrice priorité (vertical) × complexité (horizontal) ;
 *  - Synthèse : tableau ordonnable par glisser-déposer (ordre relatif personnel).
 * Les mutations sont optimistes ; en cas d'erreur, la liste est rechargée.
 */

export type ViewKey = "calendar" | "matrix" | "synthesis";
const VIEWS: Array<{ key: ViewKey; label: string; icon: typeof CalendarDays }> = [
  { key: "calendar", label: "Calendrier", icon: CalendarDays },
  { key: "matrix", label: "Sélection", icon: Grid3x3 },
  { key: "synthesis", label: "Synthèse", icon: ListOrdered },
];

export type OrganizerActions = {
  patchTask: (id: string, data: Partial<Pick<OrganizerTask, "priority" | "complexity" | "status" | "dueDate">>) => Promise<void>;
  addSession: (taskId: string, date: string) => Promise<void>;
  removeSession: (taskId: string, sessionId: string) => Promise<void>;
  moveSession: (taskId: string, sessionId: string, date: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
};

function viewFromHash(): ViewKey {
  if (typeof window === "undefined") return "calendar";
  const h = window.location.hash.replace("#", "") as ViewKey;
  return VIEWS.some((v) => v.key === h) ? h : "calendar";
}

export function TaskOrganizer({ initial }: { initial: OrganizerDto }) {
  const [tasks, setTasks] = useState(initial.tasks);
  const [view, setView] = useState<ViewKey>("calendar");
  const [saving, setSaving] = useState(0);

  useEffect(() => {
    setView(viewFromHash());
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectView = (key: ViewKey) => {
    setView(key);
    history.replaceState(null, "", `#${key}`);
  };

  const reload = useCallback(async () => {
    const data = await api.get<OrganizerDto>("/me/tasks");
    setTasks(data.tasks);
  }, []);

  /** Mutation optimiste : applique `local`, exécute `remote`, recharge en cas d'erreur. */
  const mutate = useCallback(
    async (local: (ts: OrganizerTask[]) => OrganizerTask[], remote: () => Promise<unknown>) => {
      setTasks(local);
      setSaving((s) => s + 1);
      try {
        await remote();
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "Erreur");
        await reload().catch(() => {});
      } finally {
        setSaving((s) => s - 1);
      }
    },
    [reload],
  );

  const applySessions = useCallback((taskId: string, sessions: WorkSessionDto[]) => {
    setTasks((ts) =>
      ts.map((t) => (t.id === taskId ? { ...t, sessions: sessions.filter((s) => s.mine).map((s) => ({ id: s.id, date: s.date, late: s.late })) } : t)),
    );
  }, []);

  const actions = useMemo<OrganizerActions>(
    () => ({
      patchTask: (id, data) =>
        mutate(
          (ts) => ts.map((t) => (t.id === id ? { ...t, ...data } : t)),
          () => api.patch<TaskMutation>(`/tasks/${id}`, data),
        ),
      addSession: (taskId, date) =>
        mutate(
          (ts) =>
            ts.map((t) => {
              if (t.id !== taskId || t.sessions.some((s) => s.date === date)) return t;
              const late = t.dueDate ? date > t.dueDate.slice(0, 10) : false;
              return { ...t, sessions: [...t.sessions, { id: `tmp-${date}`, date, late }].sort((a, b) => a.date.localeCompare(b.date)) };
            }),
          async () => {
            const { sessions } = await api.post<{ sessions: WorkSessionDto[] }>(`/tasks/${taskId}/sessions`, { date });
            applySessions(taskId, sessions);
          },
        ),
      removeSession: (taskId, sessionId) =>
        mutate(
          (ts) => ts.map((t) => (t.id === taskId ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t)),
          async () => {
            const { sessions } = await api.delete<{ sessions: WorkSessionDto[] }>(`/sessions/${sessionId}`);
            applySessions(taskId, sessions);
          },
        ),
      moveSession: (taskId, sessionId, date) =>
        mutate(
          (ts) =>
            ts.map((t) => {
              if (t.id !== taskId) return t;
              const late = t.dueDate ? date > t.dueDate.slice(0, 10) : false;
              const rest = t.sessions.filter((s) => s.id !== sessionId && s.date !== date);
              return { ...t, sessions: [...rest, { id: `tmp-${date}`, date, late }].sort((a, b) => a.date.localeCompare(b.date)) };
            }),
          async () => {
            await api.delete(`/sessions/${sessionId}`);
            const { sessions } = await api.post<{ sessions: WorkSessionDto[] }>(`/tasks/${taskId}/sessions`, { date });
            applySessions(taskId, sessions);
          },
        ),
      reorder: (ids) => {
        const rank = new Map(ids.map((id, i) => [id, i]));
        return mutate(
          (ts) =>
            [...ts.map((t) => (rank.has(t.id) ? { ...t, rank: rank.get(t.id)! } : t))].sort((a, b) => {
              if (a.rank === null && b.rank === null) return 0;
              if (a.rank === null) return 1;
              if (b.rank === null) return -1;
              return a.rank - b.rank;
            }),
          () => api.put("/me/tasks/order", { taskIds: ids }),
        );
      },
    }),
    [mutate, applySessions],
  );

  const open = useMemo(() => tasks.filter((t) => !isFinished(t.status)), [tasks]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organiser mes tâches</h1>
          <p className="mt-1 text-sm text-muted">
            {open.length} tâche{open.length > 1 ? "s" : ""} ouverte{open.length > 1 ? "s" : ""} · {open.filter((t) => t.sessions.length > 0).length} planifiée
            {open.filter((t) => t.sessions.length > 0).length > 1 ? "s" : ""}
          </p>
        </div>
        <span className={`text-xs ${saving ? "text-warn" : "text-faint"}`}>{saving ? "Enregistrement…" : "Enregistré"}</span>
        <div className="ml-auto flex w-full gap-1 rounded-xl bg-surface-2 p-1 sm:w-auto">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => selectView(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                view === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {open.length === 0 && tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
          Aucune tâche à organiser : affectez-vous des tâches dans vos projets (onglet Plan), ou créez des tâches dans un projet dont vous êtes propriétaire.
        </p>
      ) : (
        <>
          {view === "calendar" && <CalendarView tasks={tasks} actions={actions} />}
          {view === "matrix" && <MatrixView tasks={open} actions={actions} />}
          {view === "synthesis" && <SynthesisView tasks={open} actions={actions} />}
        </>
      )}
    </div>
  );
}

/** Carte compacte d'une tâche, partagée par les vues. */
export function TaskChip({ task, className = "", children }: { task: OrganizerTask; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-xs leading-snug ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor ?? "#4f5ff0" }} title={task.projectName} />
        <span className="truncate font-medium">{task.name}</span>
      </div>
      {children}
    </div>
  );
}
