"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarRange, Info } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import { GanttChart, type GanttScale, type GanttTask } from "@/components/charts/GanttChart";
import { PALETTE } from "@/components/charts/AmChart";
import { isFinished, toast } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/**
 * Onglet « Gantt » de la fiche projet : tâches planifiées par étape, flèches
 * de prérequis, échelle jour / semaine / mois ; glisser une barre décale la
 * tâche (début et échéance), éventuellement avec les tâches qui en dépendent.
 */

const DAY = 86_400_000;
const SCALES: { key: GanttScale; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

function shiftDay(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

type Ordered = { task: TaskDto; group: string; color: string };

/** Tâches dans l'ordre du plan : étapes (activités puis tâches directes), puis tâches sans étape. */
function orderedTasks(project: ProjectDto): Ordered[] {
  const out: Ordered[] = [];
  project.stages.forEach((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    for (const a of s.activities) for (const t of a.tasks) out.push({ task: t, group: `${s.name} › ${a.name}`, color });
    for (const t of s.tasks) out.push({ task: t, group: s.name, color });
  });
  for (const t of project.tasks) out.push({ task: t, group: "Sans étape", color: "#94a3b8" });
  return out;
}

export function ProjectGanttTab({ project, run }: { project: ProjectDto; run: Run }) {
  const router = useRouter();
  const [scale, setScale] = useState<GanttScale>("week");
  const [cascade, setCascade] = useState(true);
  const [busy, setBusy] = useState(false);

  const ordered = useMemo(() => orderedTasks(project), [project]);
  const byId = useMemo(() => new Map(ordered.map((o) => [o.task.id, o.task])), [ordered]);

  const ganttTasks: GanttTask[] = useMemo(
    () =>
      ordered
        .filter(({ task: t }) => t.startDate || t.dueDate)
        .map(({ task: t, group, color }) => {
          const start = (t.startDate ?? t.dueDate)!.slice(0, 10);
          let end = (t.dueDate ?? t.startDate)!.slice(0, 10);
          if (end < start) end = start;
          const prerequisiteIds = (t.prerequisiteIds ?? []).filter((id) => byId.has(id));
          const conflict = prerequisiteIds.some((id) => {
            const p = byId.get(id)!;
            const pEnd = (p.dueDate ?? p.startDate)?.slice(0, 10);
            return !!pEnd && pEnd > start;
          });
          return { id: t.id, name: t.name, group, color, start, end, percent: t.progress, done: isFinished(t.status), prerequisiteIds, conflict };
        }),
    [ordered, byId],
  );
  const unplanned = ordered.filter(({ task: t }) => !t.startDate && !t.dueDate);
  const conflicts = ganttTasks.filter((t) => t.conflict);
  const legend = project.stages.map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length] }));

  /** Tâches qui dépendent (directement ou non) de `id`. */
  function dependentsOf(id: string): string[] {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const t of byId.values()) if (t.prerequisiteIds?.includes(cur) && !out.has(t.id) && t.id !== id) {
        out.add(t.id);
        stack.push(t.id);
      }
    }
    return [...out];
  }

  async function move(taskId: string, days: number) {
    if (busy) return;
    const ids = [taskId, ...(cascade ? dependentsOf(taskId) : [])].filter((id) => {
      const t = byId.get(id);
      return t && (t.startDate || t.dueDate);
    });
    setBusy(true);
    try {
      await run(async () => {
        let last: Resp = { project: null };
        for (const id of ids) {
          const t = byId.get(id)!;
          last = await api.patch<Resp>(`/tasks/${id}`, { startDate: shiftDay(t.startDate, days), dueDate: shiftDay(t.dueDate, days) });
        }
        return last;
      });
      const what = ids.length > 1 ? `${ids.length} tâches décalées` : "Tâche décalée";
      toast(`${what} de ${days > 0 ? "+" : ""}${days} jour${Math.abs(days) > 1 ? "s" : ""}.`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Déplacement impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarRange className="h-5 w-5 text-brand-600" /> Gantt
        </h2>
        <div className="flex rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Échelle de temps">
          {SCALES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={scale === s.key}
              onClick={() => setScale(s.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors md:py-1 ${scale === s.key ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-600)]" />
          Décaler aussi les tâches qui en dépendent
        </label>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Glissez une barre pour décaler la tâche (au jour près) ; double-cliquez ou cliquez sur son nom pour l&apos;ouvrir. Les flèches relient un prérequis à la tâche qui en dépend.
      </p>

      {legend.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Étapes">
          {legend.map((l) => (
            <li key={l.name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
              {l.name}
            </li>
          ))}
        </ul>
      )}

      {conflicts.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {conflicts.length} tâche{conflicts.length > 1 ? "s commencent" : " commence"} avant la fin d&apos;un prérequis : {conflicts.map((c) => c.name).join(", ")}.
        </p>
      )}

      <div className={`mt-3 -mx-1 overflow-x-auto ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <div className="min-w-[640px] px-1">
          <GanttChart tasks={ganttTasks} scale={scale} onMove={(id, d) => void move(id, d)} onOpen={(id) => router.push(`/tasks/${id}`)} />
        </div>
      </div>

      {unplanned.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-medium text-muted">Sans date ({unplanned.length}) — ajoutez un début ou une échéance pour les placer :</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {unplanned.map(({ task: t }) => (
              <li key={t.id}>
                <button type="button" onClick={() => router.push(`/tasks/${t.id}`)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
