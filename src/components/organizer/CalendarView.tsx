"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Flag, GripVertical, X } from "lucide-react";
import type { OrganizerTask } from "@/lib/tasks";
import { PRIORITY_CHIP, PRIORITY_LABEL, PriorityFlag, formatDate, isFinished, todayYmd, ymd } from "@/components/ui";
import type { OrganizerActions } from "./TaskOrganizer";

/**
 * Vue calendaire (grille mensuelle type Outlook). On glisse une tâche de la
 * liste sur un jour pour planifier une session de travail ; une tâche déjà
 * planifiée se grise mais reste déposable sur d'autres jours. Les sessions
 * se déplacent d'un jour à l'autre et se retirent (×). Une session après
 * l'échéance est signalée (bordure rouge, icône d'alerte).
 * Sans glisser-déposer (tactile) : cliquer une tâche puis un jour.
 */

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DRAG_TASK = "application/x-sb-task";
const DRAG_SESSION = "application/x-sb-session";

function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // lundi précédent (ou le 1er)
  const weeks: string[][] = [];
  const cur = new Date(start);
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(ymd(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  } while (cur.getMonth() === month && weeks.length < 6);
  return weeks;
}

export function CalendarView({ tasks, actions }: { tasks: OrganizerTask[]; actions: OrganizerActions }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const today = todayYmd();

  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const open = useMemo(() => tasks.filter((t) => !isFinished(t.status)), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  /** Sessions et échéances par jour. */
  const byDay = useMemo(() => {
    const sessions = new Map<string, Array<{ task: OrganizerTask; id: string; late: boolean }>>();
    const due = new Map<string, OrganizerTask[]>();
    for (const t of tasks) {
      for (const s of t.sessions) sessions.set(s.date, [...(sessions.get(s.date) ?? []), { task: t, id: s.id, late: s.late }]);
      if (t.dueDate && !isFinished(t.status)) {
        const d = t.dueDate.slice(0, 10);
        due.set(d, [...(due.get(d) ?? []), t]);
      }
    }
    return { sessions, due };
  }, [tasks]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const dropOnDay = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData(DRAG_TASK);
    const session = e.dataTransfer.getData(DRAG_SESSION);
    if (session) {
      const [tId, sId, from] = session.split("|");
      if (from !== date) void actions.moveSession(tId, sId, date);
    } else if (taskId) void actions.addSession(taskId, date);
  };

  const clickDay = (date: string) => {
    if (!selectedTask) return;
    void actions.addSession(selectedTask, date);
    setSelectedTask(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      {/* Liste des tâches à planifier */}
      <aside className="rounded-2xl border border-line bg-surface p-3 lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto">
        <h2 className="mb-1 text-sm font-semibold">Tâches à planifier</h2>
        <p className="mb-3 text-[11px] text-muted">Glissez une tâche sur un jour (ou cliquez-la puis cliquez un jour). Une tâche planifiée se grise mais peut recevoir d&apos;autres jours.</p>
        <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {open.map((t) => {
            const planned = t.sessions.length > 0;
            const hasLate = t.sessions.some((s) => s.late);
            return (
              <li
                key={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TASK, t.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => setSelectedTask((s) => (s === t.id ? null : t.id))}
                className={`w-56 shrink-0 cursor-grab select-none rounded-lg border px-2 py-1.5 text-xs transition-opacity active:cursor-grabbing lg:w-auto ${PRIORITY_CHIP[t.priority]} ${
                  planned ? "opacity-50 hover:opacity-80" : ""
                } ${selectedTask === t.id ? "ring-2 ring-brand-500 ring-offset-1 opacity-100" : ""}`}
                title={`${t.projectName}${t.stageName ? ` › ${t.stageName}` : ""}${t.dueDate ? ` · échéance ${formatDate(t.dueDate)}` : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <span className="truncate font-medium">{t.name}</span>
                  {hasLate && <AlertTriangle className="ml-auto h-3.5 w-3.5 shrink-0 text-danger" aria-label="Session après l'échéance" />}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[11px] opacity-80">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.projectColor ?? "#4f5ff0" }} />
                  <span className="truncate">{t.projectName}</span>
                  <span className="ml-auto whitespace-nowrap">
                    {PRIORITY_LABEL[t.priority]}
                    {planned ? ` · ${t.sessions.length} j` : ""}
                  </span>
                </div>
              </li>
            );
          })}
          {open.length === 0 && <li className="text-xs text-muted">Aucune tâche ouverte.</li>}
        </ul>
      </aside>

      {/* Grille mensuelle */}
      <section className="rounded-2xl border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg p-2 hover:bg-surface-2 md:p-1.5" title="Mois précédent" aria-label="Mois précédent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shift(1)} className="rounded-lg p-2 hover:bg-surface-2 md:p-1.5" title="Mois suivant" aria-label="Mois suivant">
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold capitalize sm:text-base">{monthLabel}</h2>
          <button type="button" onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })} className="ml-auto rounded-lg border border-line-strong px-2.5 py-1.5 text-xs hover:bg-surface-2 md:px-2 md:py-1">
            Aujourd&apos;hui
          </button>
          {selectedTask && (
            <span className="w-full text-xs text-brand-700 sm:w-auto">Cliquez un jour pour « {byId.get(selectedTask)?.name} »</span>
          )}
        </header>
        <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-medium uppercase tracking-wide text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((date) => {
            const inMonth = Number(date.slice(5, 7)) - 1 === cursor.month;
            const isToday = date === today;
            const sessions = byDay.sessions.get(date) ?? [];
            const due = byDay.due.get(date) ?? [];
            const weekend = [6, 0].includes(new Date(`${date}T12:00:00`).getDay());
            return (
              <div
                key={date}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== date) setDragOver(date);
                }}
                onDragLeave={() => dragOver === date && setDragOver(null)}
                onDrop={(e) => dropOnDay(e, date)}
                onClick={() => clickDay(date)}
                className={`min-h-[4.5rem] border-b border-r border-line p-1 transition-colors sm:min-h-24 ${inMonth ? (weekend ? "bg-surface-2/40" : "") : "bg-surface-2/70 text-faint"} ${
                  dragOver === date ? "bg-brand-50 ring-2 ring-inset ring-brand-500" : ""
                } ${selectedTask ? "cursor-pointer hover:bg-brand-50" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-brand-600 font-semibold text-on-brand" : ""}`}>{Number(date.slice(8, 10))}</span>
                  {due.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-danger" title={`Échéance : ${due.map((t) => t.name).join(", ")}`}>
                      <Flag className="h-3 w-3" fill="currentColor" /> {due.length}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {sessions.map(({ task, id, late }) => (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData(DRAG_SESSION, `${task.id}|${id}|${date}`);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`group flex cursor-grab items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-tight active:cursor-grabbing sm:text-[11px] ${PRIORITY_CHIP[task.priority]} ${
                        late ? "border-danger ring-1 ring-red-200" : ""
                      } ${isFinished(task.status) ? "opacity-50 line-through" : ""}`}
                      title={`${task.name} — ${task.projectName}${late ? " — APRÈS L'ÉCHÉANCE" : ""}`}
                    >
                      {late && <AlertTriangle className="h-3 w-3 shrink-0 text-danger" />}
                      <PriorityFlag priority={task.priority} className="hidden !h-3 !w-3 sm:block" />
                      <Link draggable={false} href={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:underline" onClick={(e) => e.stopPropagation()}>
                        {task.name}
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actions.removeSession(task.id, id);
                        }}
                        className="-my-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-60 hover:bg-surface/60 hover:opacity-100 sm:m-0 sm:h-auto sm:w-auto sm:opacity-40"
                        title="Retirer cette session"
                        aria-label={`Retirer la session de « ${task.name} »`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <footer className="flex flex-wrap items-center gap-3 px-3 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className={`h-3 w-5 rounded border ${PRIORITY_CHIP.CRITICAL}`} /> Critique
          </span>
          <span className="flex items-center gap-1">
            <span className={`h-3 w-5 rounded border ${PRIORITY_CHIP.HIGH}`} /> Haute
          </span>
          <span className="flex items-center gap-1">
            <span className={`h-3 w-5 rounded border ${PRIORITY_CHIP.MEDIUM}`} /> Moyenne
          </span>
          <span className="flex items-center gap-1">
            <span className={`h-3 w-5 rounded border ${PRIORITY_CHIP.LOW}`} /> Basse
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-danger" /> session après l&apos;échéance
          </span>
          <span className="flex items-center gap-1">
            <Flag className="h-3 w-3 text-danger" fill="currentColor" /> échéance
          </span>
        </footer>
      </section>
    </div>
  );
}
