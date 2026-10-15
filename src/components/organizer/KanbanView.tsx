"use client";

import { useMemo, useState } from "react";
import type { OrganizerTask } from "@/lib/tasks";
import { KanbanBoard, type KanbanTask } from "@/components/tasks/KanbanBoard";
import { selectClass, ymd } from "@/components/ui";
import type { OrganizerActions } from "./TaskOrganizer";

/**
 * Vue Kanban de « Mes tâches » : mes tâches de tous les projets par statut,
 * avec un filtre : échéances de la semaine, sessions de travail de la
 * semaine, tâches dont je suis responsable / superviseur / contributeur,
 * ou toutes.
 */

type FilterKey = "all" | "week-due" | "week-sessions" | "assigned" | "supervising" | "contributing";
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "Toutes mes tâches" },
  { key: "week-due", label: "Mes tâches de la semaine (échéances)" },
  { key: "week-sessions", label: "Mes tâches de la semaine (sessions de travail)" },
  { key: "assigned", label: "Mes tâches (assignation)" },
  { key: "supervising", label: "Mes tâches (supervision)" },
  { key: "contributing", label: "Mes tâches (contribution)" },
];

/** Lundi et dimanche de la semaine courante, au format AAAA-MM-JJ. */
function currentWeek(): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: ymd(monday), to: ymd(sunday) };
}

export function KanbanView({ tasks, actions }: { tasks: OrganizerTask[]; actions: OrganizerActions }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const week = useMemo(currentWeek, []);

  const filtered = useMemo(() => {
    const inWeek = (d: string) => d >= week.from && d <= week.to;
    switch (filter) {
      case "week-due":
        return tasks.filter((t) => t.dueDate && inWeek(t.dueDate.slice(0, 10)));
      case "week-sessions":
        return tasks.filter((t) => t.sessions.some((s) => inWeek(s.date)));
      case "assigned":
        return tasks.filter((t) => t.roles.assigned);
      case "supervising":
        return tasks.filter((t) => t.roles.supervising);
      case "contributing":
        return tasks.filter((t) => t.roles.contributing);
      default:
        return tasks;
    }
  }, [tasks, filter, week]);

  const cards = useMemo<KanbanTask[]>(
    () =>
      filtered.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        progress: t.progress,
        context: [t.projectName, t.stageName].filter(Boolean).join(" › "),
        contextColor: t.projectColor,
        assignee: null,
        commentCount: t.commentCount,
      })),
    [filtered],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex w-full min-w-0 items-center gap-2 text-sm text-muted sm:w-auto">
          Filtre
          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)} className={`${selectClass} min-w-0 max-w-full flex-1 sm:flex-none`}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted">
          {filtered.length} tâche{filtered.length > 1 ? "s" : ""}
          {filter.startsWith("week") ? ` · semaine du ${new Date(`${week.from}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} au ${new Date(`${week.to}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}` : ""}
        </span>
      </div>
      <KanbanBoard tasks={cards} onMove={(id, status) => actions.patchTask(id, { status })} emptyHint="Aucune tâche pour ce filtre." />
    </div>
  );
}
