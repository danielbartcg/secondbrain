"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { OverviewTask } from "@/lib/tasks";
import { Badge, PriorityFlag, TASK_STATUSES, TASK_STATUS_LABEL, TASK_STATUS_TONE, formatDate, isFinished, selectClass, todayYmd } from "@/components/ui";

/**
 * Tableau de consultation de tâches (administration, équipe d'un manager) :
 * recherche, filtre de statut (ouvertes par défaut), liens vers les fiches en
 * lecture seule.
 */
export function TaskOverviewTable({ tasks, showOwner = true }: { tasks: OverviewTask[]; showOwner?: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"open" | "all" | (typeof TASK_STATUSES)[number]>("open");
  const today = todayYmd();

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (status === "open" && isFinished(t.status)) return false;
      if (status !== "open" && status !== "all" && t.status !== status) return false;
      if (!needle) return true;
      return [t.name, t.projectName, t.ownerName, t.assigneeName ?? "", t.supervisorName ?? "", ...t.contributorNames].some((s) => s.toLowerCase().includes(needle));
    });
  }, [tasks, q, status]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 sm:max-w-xs">
          <Search className="h-4 w-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tâche, projet, personne…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectClass}>
          <option value="open">Ouvertes</option>
          <option value="all">Toutes</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {visible.length} / {tasks.length} tâche{tasks.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Tâche</th>
              <th className="px-3 py-2">Projet</th>
              {showOwner && <th className="px-3 py-2">Créée par</th>}
              <th className="px-3 py-2">Responsable</th>
              <th className="px-3 py-2">Superviseur / contributeurs</th>
              <th className="px-3 py-2">Échéance</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((t) => {
              const late = t.dueDate ? t.dueDate.slice(0, 10) < today && !isFinished(t.status) : false;
              return (
                <tr key={t.id} className="hover:bg-surface-2/60">
                  <td className="max-w-[18rem] px-3 py-2">
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                      <PriorityFlag priority={t.priority} /> <span className="truncate">{t.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.projectColor ?? "#94a3b8" }} />
                      <span className="truncate">{t.projectName}</span>
                    </span>
                    {t.stageName && <span className="block truncate text-xs text-muted">{t.stageName}</span>}
                  </td>
                  {showOwner && <td className="px-3 py-2 text-ink-2">{t.ownerName}</td>}
                  <td className="px-3 py-2 text-ink-2">{t.assigneeName ?? <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {t.supervisorName && <div>👁 {t.supervisorName}</div>}
                    {t.contributorNames.length > 0 && <div className="truncate">{t.contributorNames.join(", ")}</div>}
                    {!t.supervisorName && t.contributorNames.length === 0 && <span className="text-faint">—</span>}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-xs ${late ? "font-medium text-danger" : "text-muted"}`}>{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  Aucune tâche pour ces critères.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
