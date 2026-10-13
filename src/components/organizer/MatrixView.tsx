"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { OrganizerTask } from "@/lib/tasks";
import { COMPLEXITIES, COMPLEXITY_LABEL, PRIORITIES, PRIORITY_CHIP, PRIORITY_COLOR, PRIORITY_LABEL, formatDate, todayYmd, type Complexity, type Priority } from "@/components/ui";
import type { OrganizerActions } from "./TaskOrganizer";

/**
 * Vue « Sélection » : matrice priorité (vertical, Critique en haut) ×
 * complexité (horizontal : Basse, Moyenne, Forte). Chaque tâche est placée
 * sur sa priorité et sa complexité ; glisser-déposer une tâche dans une autre
 * zone met à jour sa complexité (et sa priorité si la ligne change).
 */
const DRAG = "application/x-sb-task";

export function MatrixView({ tasks, actions }: { tasks: OrganizerTask[]; actions: OrganizerActions }) {
  const [over, setOver] = useState<string | null>(null);
  const today = todayYmd();
  const cells = useMemo(() => {
    const m = new Map<string, OrganizerTask[]>();
    for (const t of tasks) {
      const k = `${t.priority}|${t.complexity}`;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const drop = (e: React.DragEvent, priority: Priority, complexity: Complexity) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG);
    const t = tasks.find((x) => x.id === id);
    if (!t || (t.priority === priority && t.complexity === complexity)) return;
    void actions.patchTask(id, { priority, complexity });
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[7rem_repeat(3,1fr)] border-b border-line text-center text-xs font-medium uppercase tracking-wide text-muted">
          <div className="p-2 text-left normal-case tracking-normal">
            <span className="block text-[11px]">↓ priorité</span>
            <span className="block text-[11px]">complexité →</span>
          </div>
          {COMPLEXITIES.map((c) => (
            <div key={c} className="p-2">
              {COMPLEXITY_LABEL[c]}
            </div>
          ))}
        </div>
        {PRIORITIES.map((p) => (
          <div key={p} className="grid grid-cols-[7rem_repeat(3,1fr)] border-b border-line last:border-b-0">
            <div className="flex items-center gap-2 p-2 text-sm font-medium" style={{ color: PRIORITY_COLOR[p] }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[p] }} />
              {PRIORITY_LABEL[p]}
            </div>
            {COMPLEXITIES.map((c) => {
              const key = `${p}|${c}`;
              const list = cells.get(key) ?? [];
              return (
                <div
                  key={key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (over !== key) setOver(key);
                  }}
                  onDragLeave={() => over === key && setOver(null)}
                  onDrop={(e) => drop(e, p, c)}
                  className={`min-h-24 space-y-1 border-l border-line p-1.5 transition-colors ${over === key ? "bg-brand-50 ring-2 ring-inset ring-brand-400" : ""}`}
                >
                  {list.map((t) => {
                    const late = t.dueDate ? t.dueDate.slice(0, 10) < today : false;
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG, t.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className={`cursor-grab rounded-lg border px-2 py-1.5 text-xs active:cursor-grabbing ${PRIORITY_CHIP[t.priority]}`}
                      >
                        <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">
                          {t.name}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] opacity-80">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.projectColor ?? "#4f5ff0" }} />
                          <span className="truncate">{t.projectName}</span>
                          {t.dueDate && (
                            <span className={`ml-auto flex shrink-0 items-center gap-0.5 ${late ? "font-semibold text-danger" : ""}`}>
                              <CalendarDays className="h-3 w-3" /> {formatDate(t.dueDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
