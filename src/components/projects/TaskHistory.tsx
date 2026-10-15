"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { api } from "@/lib/client";
import type { TaskEventDto } from "@/lib/task-events";
import { Avatar } from "@/components/ui";

/**
 * Piste d'audit d'une tâche (fiche tâche) : toutes les modifications, la plus
 * récente d'abord, regroupées par jour. Repliée par défaut ; rechargée quand
 * la tâche change (`version`).
 */

const KIND_FILTERS = [
  { key: "all", label: "Tout" },
  { key: "changes", label: "Modifications" },
  { key: "people", label: "Personnes" },
  { key: "comment", label: "Commentaires" },
] as const;
type Filter = (typeof KIND_FILTERS)[number]["key"];

function matches(e: TaskEventDto, f: Filter) {
  if (f === "all") return true;
  if (f === "comment") return e.kind === "comment";
  if (f === "people") return e.kind === "assignee" || e.kind === "supervisor" || e.kind === "contributors";
  return e.kind !== "comment";
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function TaskHistory({ taskId, version }: { taskId: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TaskEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<{ events: TaskEventDto[] }>(`/tasks/${taskId}/history`)
      .then((r) => {
        if (!cancelled) {
          setEvents(r.events);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Historique indisponible."));
    return () => {
      cancelled = true;
    };
  }, [open, taskId, version]);

  const visible = (events ?? []).filter((e) => matches(e, filter));

  return (
    <section className="mt-6 rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-2"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <History className="h-4 w-4 text-brand-600" /> Historique des modifications
        {events && <span className="ml-1 text-xs font-normal text-muted">({events.length})</span>}
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Filtrer l'historique">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f.key ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {events === null && !error && <p className="mt-2 text-sm text-muted">Chargement…</p>}
          {events && visible.length === 0 && <p className="mt-2 text-sm text-muted">Aucune entrée.</p>}
          <ol className="mt-1">
            {visible.map((e, i) => {
              const newDay = i === 0 || new Date(visible[i - 1].createdAt).toDateString() !== new Date(e.createdAt).toDateString();
              return (
                <li key={e.id}>
                  {newDay && <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{dayLabel(e.createdAt)}</div>}
                  <div className="flex items-start gap-2 py-1.5">
                    <Avatar id={e.actorId ?? e.id} name={e.actorName} src={e.actorAvatarUrl} size={22} className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="break-words text-ink-2">{e.message}</p>
                      <time className="text-[11px] text-faint" dateTime={e.createdAt}>
                        {new Date(e.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
