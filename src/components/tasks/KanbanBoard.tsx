"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, Lock, MoreHorizontal } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { Avatar, PRIORITY_CHIP, PriorityFlag, TASK_STATUSES, TASK_STATUS_COLOR, TASK_STATUS_LABEL, formatDate, todayYmd } from "@/components/ui";

/**
 * Kanban partagé (projet et « Mes tâches ») : une colonne par statut
 * (À faire, En cours, Terminée, Clôturée). Les cartes se glissent d'une
 * colonne à l'autre (changement de statut) et portent un lien vers la fiche
 * tâche. La colonne « Clôturée » est repliée par défaut (tâches non ouvertes).
 * Glisser-déposer natif HTML5 ; sur tactile, le bouton « … » de la carte
 * propose les autres colonnes.
 */

export type KanbanTask = {
  id: string;
  name: string;
  status: TaskStatus;
  priority: keyof typeof PRIORITY_CHIP;
  dueDate: string | null;
  progress: number;
  /** Contexte affiché sous le titre (projet › étape, ou étape › activité). */
  context?: string | null;
  contextColor?: string | null;
  assignee?: { id: string; name: string; color: string | null; avatarUrl?: string | null } | null;
  commentCount?: number;
};

const DRAG = "application/x-sb-kanban";

export function KanbanBoard({ tasks, onMove, emptyHint }: { tasks: KanbanTask[]; onMove: (id: string, status: TaskStatus) => void | Promise<void>; emptyHint?: string }) {
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Rendu progressif : PAGE cartes par colonne, puis « Afficher plus » (gros volumes).
  const [shown, setShown] = useState<Partial<Record<TaskStatus, number>>>({});
  const today = todayYmd();

  // Menu « Déplacer » : fermeture au clic extérieur et sur Échap.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-kanban-menu]")) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const PAGE = 50;
  const columns = useMemo(() => {
    const m = new Map<TaskStatus, KanbanTask[]>(TASK_STATUSES.map((s) => [s, []]));
    for (const t of tasks) m.get(t.status)!.push(t);
    return m;
  }, [tasks]);

  const drop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG);
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    void onMove(id, status);
  };

  if (tasks.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">{emptyHint ?? "Aucune tâche."}</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[760px] grid-cols-4 gap-3">
        {TASK_STATUSES.map((status) => {
          const list = columns.get(status)!;
          const closedCol = status === "CLOSED";
          const collapsed = closedCol && !showClosed;
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== status) setOver(status);
              }}
              onDragLeave={() => over === status && setOver(null)}
              onDrop={(e) => drop(e, status)}
              className={`flex min-h-[16rem] flex-col rounded-2xl border bg-surface-2/60 transition-colors ${over === status ? "border-brand-500 bg-brand-50 ring-2 ring-inset ring-brand-100" : "border-line"}`}
            >
              <header className="flex items-center gap-2 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TASK_STATUS_COLOR[status] }} />
                <h3 className="text-sm font-semibold">{TASK_STATUS_LABEL[status]}</h3>
                <span className="rounded-full bg-surface-3 px-1.5 text-xs text-muted">{list.length}</span>
                {closedCol && list.length > 0 && (
                  <button type="button" onClick={() => setShowClosed((v) => !v)} className="ml-auto text-[11px] text-muted hover:text-ink">
                    {showClosed ? "Masquer" : "Afficher"}
                  </button>
                )}
              </header>
              <div className="flex-1 space-y-2 px-2 pb-2">
                {collapsed ? (
                  list.length > 0 && (
                    <p className="flex items-center gap-1 px-1 text-xs text-muted">
                      <Lock className="h-3.5 w-3.5" /> {list.length} tâche{list.length > 1 ? "s" : ""} clôturée{list.length > 1 ? "s" : ""} — déposez ici pour clôturer.
                    </p>
                  )
                ) : (
                  list.slice(0, shown[status] ?? PAGE).map((t) => {
                    const late = t.dueDate ? t.dueDate.slice(0, 10) < today && t.status !== "DONE" && t.status !== "CLOSED" : false;
                    return (
                      <article
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG, t.id);
                          e.dataTransfer.effectAllowed = "move";
                          setMenuFor(null);
                        }}
                        className={`group relative cursor-grab rounded-xl border bg-surface p-2.5 shadow-sm active:cursor-grabbing ${closedCol ? "opacity-70" : ""}`}
                        style={{ borderColor: t.contextColor ?? undefined }}
                      >
                        <div className="flex items-start gap-1.5">
                          <PriorityFlag priority={t.priority} className="mt-0.5" />
                          <Link draggable={false} href={`/tasks/${t.id}`} className={`min-w-0 flex-1 text-sm font-medium leading-snug hover:underline ${t.status === "DONE" || closedCol ? "text-muted line-through" : ""}`}>
                            {t.name}
                          </Link>
                          <Link draggable={false} href={`/tasks/${t.id}`} className="-m-1 rounded p-1.5 text-faint hover:bg-surface-2 hover:text-ink" title="Ouvrir la fiche tâche" aria-label="Ouvrir la fiche tâche">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                        {t.context && (
                          <div className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted">
                            {t.contextColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.contextColor }} />}
                            <span className="truncate">{t.context}</span>
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                          {t.dueDate && (
                            <span className={`flex items-center gap-0.5 ${late ? "font-medium text-danger" : ""}`}>
                              <CalendarDays className="h-3 w-3" /> {formatDate(t.dueDate)}
                            </span>
                          )}
                          <span className="tabular-nums">{t.progress}%</span>
                          <span className="ml-auto flex items-center gap-1">
                            {t.assignee && <Avatar id={t.assignee.id} name={t.assignee.name} color={t.assignee.color} src={t.assignee.avatarUrl} size={20} />}
                            <button
                              type="button"
                              data-kanban-menu
                              onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                              className="flex h-8 w-8 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink"
                              title="Déplacer vers…"
                              aria-label="Déplacer"
                              aria-haspopup="menu"
                              aria-expanded={menuFor === t.id}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </span>
                        </div>
                        {menuFor === t.id && (
                          <div data-kanban-menu role="menu" className="absolute right-2 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
                            {TASK_STATUSES.filter((s) => s !== t.status).map((s) => (
                              <button
                                key={s}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuFor(null);
                                  void onMove(t.id, s);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-surface-2 md:py-1.5"
                              >
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TASK_STATUS_COLOR[s] }} /> {TASK_STATUS_LABEL[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
                {!collapsed && list.length > (shown[status] ?? PAGE) && (
                  <button
                    type="button"
                    onClick={() => setShown((m) => ({ ...m, [status]: (m[status] ?? PAGE) + PAGE * 4 }))}
                    className="w-full rounded-lg py-1.5 text-xs font-medium text-brand-700 hover:bg-surface"
                  >
                    Afficher plus ({list.length - (shown[status] ?? PAGE)} restante{list.length - (shown[status] ?? PAGE) > 1 ? "s" : ""})
                  </button>
                )}
                {!collapsed && list.length === 0 && <p className="px-1 py-6 text-center text-xs text-faint">Déposez une tâche ici</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
