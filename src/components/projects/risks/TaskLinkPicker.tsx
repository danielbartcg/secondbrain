"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, TASK_STATUS_COLOR, inputClass } from "@/components/ui";

export type PickableTask = { id: string; name: string; status: keyof typeof TASK_STATUS_COLOR; path: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Sélection multiple des tâches du projet à lier à un risque : fenêtre
 * centrée (tiroir bas sur mobile), recherche sur « étape › activité › tâche ».
 */
export function TaskLinkPicker({
  title,
  tasks,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  tasks: PickableTask[];
  initial: string[];
  onClose: () => void;
  onSave: (taskIds: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const n = norm(q.trim());
    const list = n ? tasks.filter((t) => norm(`${t.path} ${t.name}`).includes(n)) : tasks;
    // Tâches déjà cochées en tête.
    return [...list].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tasks]);

  function toggle(id: string) {
    setSel((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="min-w-0 flex-1 truncate font-semibold">{title}</h3>
          <button type="button" onClick={onClose} title="Fermer" className="rounded-lg p-1.5 text-muted hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-line p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une tâche, une étape…" aria-label="Rechercher une tâche" className={`${inputClass} w-full pl-9`} />
          </label>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 && <li className="p-4 text-center text-sm text-muted">{tasks.length === 0 ? "Le projet ne contient aucune tâche." : "Aucune tâche ne correspond."}</li>}
          {shown.map((t) => (
            <li key={t.id}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} className="mt-1 h-4 w-4 shrink-0 accent-brand-600" />
                <span className="min-w-0 flex-1">
                  {t.path && <span className="block truncate text-xs text-muted">{t.path}</span>}
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TASK_STATUS_COLOR[t.status] }} />
                    <span className="truncate">{t.name}</span>
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="flex-1 text-xs text-muted">{sel.size} tâche(s) sélectionnée(s)</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" onClick={() => onSave([...sel])}>
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
