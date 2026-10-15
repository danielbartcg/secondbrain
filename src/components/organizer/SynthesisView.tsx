"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, GripVertical, Minus } from "lucide-react";
import type { OrganizerTask } from "@/lib/tasks";
import { Badge, PRIORITIES, PRIORITY_LABEL, PriorityFlag, TASK_STATUS_LABEL, TASK_STATUS_TONE, formatDate, todayYmd, selectClassXs, type Priority } from "@/components/ui";
import type { OrganizerActions } from "./TaskOrganizer";

/**
 * Vue « Synthèse » : tableau de mes tâches ouvertes (projet, étape, priorité,
 * échéance, planifiée oui/non). Les lignes se réordonnent par glisser-déposer :
 * l'ordre relatif est personnel et mémorisé. Sur mobile (pas de glisser-déposer
 * tactile), des boutons monter / descendre font la même chose.
 */
export function SynthesisView({ tasks, actions }: { tasks: OrganizerTask[]; actions: OrganizerActions }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Rendu progressif (gros volumes) : 100 lignes, puis « Afficher plus ».
  const [limit, setLimit] = useState(100);
  const today = todayYmd();

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = tasks.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    setDragId(null);
    setOverId(null);
    void actions.reorder(ids);
  };

  /** Monter (-1) ou descendre (+1) une ligne : même enregistrement que le glisser-déposer. */
  const shift = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= tasks.length) return;
    const ids = tasks.map((t) => t.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void actions.reorder(ids);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="w-10 whitespace-nowrap px-2 py-2">#</th>
            <th className="px-2 py-2">Tâche</th>
            <th className="px-2 py-2">Projet</th>
            <th className="px-2 py-2">Étape</th>
            <th className="px-2 py-2">Priorité</th>
            <th className="px-2 py-2">Échéance</th>
            <th className="px-2 py-2">Statut</th>
            <th className="px-2 py-2 text-center">Prévu ?</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.slice(0, limit).map((t, i) => {
            const late = t.dueDate ? t.dueDate.slice(0, 10) < today : false;
            const planned = t.sessions.length > 0;
            return (
              <tr
                key={t.id}
                draggable
                onDragStart={(e) => {
                  setDragId(t.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", t.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overId !== t.id) setOverId(t.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(t.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className={`transition-colors ${dragId === t.id ? "opacity-40" : ""} ${overId === t.id && dragId !== t.id ? "border-t-2 border-t-brand-500 bg-brand-50/60" : "hover:bg-surface-2/60"}`}
              >
                <td className="px-2 py-2">
                  <span className="flex cursor-grab items-center gap-1 text-muted active:cursor-grabbing" title="Glisser pour réordonner">
                    <GripVertical className="hidden h-4 w-4 md:block" />
                    <span className="text-xs tabular-nums">{i + 1}</span>
                    <span className="flex md:hidden">
                      <button type="button" onClick={() => shift(i, -1)} disabled={i === 0} className="rounded p-1.5 hover:bg-surface-3 disabled:opacity-30" aria-label={`Monter « ${t.name} »`}>
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => shift(i, 1)} disabled={i === tasks.length - 1} className="rounded p-1.5 hover:bg-surface-3 disabled:opacity-30" aria-label={`Descendre « ${t.name} »`}>
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </span>
                  </span>
                </td>
                <td className="max-w-[22rem] px-2 py-2">
                  <Link draggable={false} href={`/tasks/${t.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                    <PriorityFlag priority={t.priority} /> <span className="truncate">{t.name}</span>
                  </Link>
                </td>
                <td className="px-2 py-2">
                  <Link href={t.projectId ? `/projects/${t.projectId}` : "/projects/sans-projet"} className="flex items-center gap-1.5 text-ink-2 hover:underline">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.projectColor ?? "#4f5ff0" }} />
                    <span className="truncate">{t.projectName}</span>
                  </Link>
                </td>
                <td className="px-2 py-2 text-ink-2">
                  {t.stageName ?? <span className="text-faint">—</span>}
                  {t.activityName && <span className="text-muted"> › {t.activityName}</span>}
                </td>
                <td className="px-2 py-2">
                  <select value={t.priority} onChange={(e) => void actions.patchTask(t.id, { priority: e.target.value as Priority })} className={`${selectClassXs} py-1`} title="Changer la priorité" aria-label={`Priorité de « ${t.name} »`}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`whitespace-nowrap px-2 py-2 ${late ? "font-medium text-danger" : "text-ink-2"}`}>{t.dueDate ? formatDate(t.dueDate) : <span className="text-faint">—</span>}</td>
                <td className="px-2 py-2">
                  <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                </td>
                <td className="px-2 py-2 text-center">
                  {planned ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700" title={t.sessions.map((s) => formatDate(s.date)).join(", ")}>
                      <Check className="h-3.5 w-3.5" /> Oui · {t.sessions.length} j{t.sessions.some((s) => s.late) ? " ⚠" : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
                      <Minus className="h-3.5 w-3.5" /> Non
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {tasks.length > limit && (
            <tr>
              <td colSpan={8} className="px-4 py-2 text-center">
                <button type="button" onClick={() => setLimit((l) => l + 400)} className="text-xs font-medium text-brand-700 hover:underline">
                  Afficher plus ({tasks.length - limit} restante{tasks.length - limit > 1 ? "s" : ""})
                </button>
              </td>
            </tr>
          )}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                Aucune tâche ouverte.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted">
        <span className="hidden md:inline">Glissez les lignes</span>
        <span className="md:hidden">Utilisez les flèches</span> pour fixer votre ordre relatif ; la priorité se change directement dans la colonne.
      </p>
    </div>
  );
}
