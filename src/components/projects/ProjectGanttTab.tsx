"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarRange, Info } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import { PALETTE } from "@/components/charts/AmChart";
import { GanttView, type GanttCommit } from "@/components/gantt/GanttView";
import { NO_STAGE_COLOR, conflictIds, taskSpan, type GanttScale, type Span } from "@/components/gantt/ganttModel";
import { toast } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/**
 * Onglet « Gantt » de la fiche projet : diagramme dédié (`GanttView`) avec
 * l'étape en parent des tâches, barres déplaçables et redimensionnables,
 * liens fin → début des prérequis, échelle jour / semaine / mois ; option de
 * cascade sur les tâches qui dépendent de la tâche modifiée.
 */

const SCALES: { key: GanttScale; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

function allTasks(project: ProjectDto): TaskDto[] {
  return [...project.stages.flatMap((s) => [...s.activities.flatMap((a) => a.tasks), ...s.tasks]), ...project.tasks];
}

const plural = (n: number, one: string, many: string) => (Math.abs(n) > 1 ? many : one);

function commitMessage({ updates, mode, delta }: GanttCommit): string {
  const others = updates.length - 1;
  const cascade = others > 0 ? ` et ${others} tâche${plural(others, " dépendante décalée", "s dépendantes décalées")}` : "";
  const days = `${delta > 0 ? "+" : ""}${delta} jour${plural(delta, "", "s")}`;
  if (mode === "move") return others > 0 ? `${updates.length} tâches décalées de ${days}.` : `Tâche décalée de ${days}.`;
  return `${mode === "start" ? "Début" : "Échéance"} modifié${mode === "start" ? "" : "e"} (${days})${cascade}.`;
}

export function ProjectGanttTab({ project, run }: { project: ProjectDto; run: Run }) {
  const router = useRouter();
  const [scale, setScale] = useState<GanttScale>("week");
  const [cascade, setCascade] = useState(true);
  const [busy, setBusy] = useState(false);

  const tasks = useMemo(() => allTasks(project), [project]);
  const conflicts = useMemo(() => {
    const spans = new Map<string, Span>();
    for (const t of tasks) {
      const s = taskSpan(t);
      if (s) spans.set(t.id, s);
    }
    const ids = conflictIds(tasks, spans);
    return tasks.filter((t) => ids.has(t.id));
  }, [tasks]);
  const unplanned = tasks.filter((t) => !t.startDate && !t.dueDate);
  const legend = [
    ...project.stages.map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length] })),
    ...(project.tasks.length ? [{ name: "Sans étape", color: NO_STAGE_COLOR }] : []),
  ];

  const open = useCallback((id: string) => router.push(`/tasks/${id}`), [router]);

  const commit = useCallback(
    async (c: GanttCommit) => {
      setBusy(true);
      let ok = false;
      try {
        // `run` affiche lui-même l'erreur et recharge le projet en cas d'échec.
        await run(async () => {
          let last: Resp = { project: null };
          for (const u of c.updates) last = await api.patch<Resp>(`/tasks/${u.id}`, { startDate: u.startDate, dueDate: u.dueDate });
          ok = true;
          return last;
        });
        if (ok) toast(commitMessage(c), "ok");
      } finally {
        setBusy(false);
      }
    },
    [run],
  );

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
        <span>
          Glissez le milieu d&apos;une barre pour la déplacer, ses bords pour changer le début ou la fin ; double-cliquez pour ouvrir la tâche. Au
          clavier : ← → déplacent la barre sélectionnée, Maj + ← → changent la fin, Ctrl + ← → le début, Entrée l&apos;ouvre. Les flèches relient un
          prérequis à la tâche qui en dépend.
        </span>
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

      <div className="mt-3">
        <GanttView project={project} scale={scale} cascade={cascade} busy={busy} onCommit={commit} onOpen={open} />
      </div>

      {unplanned.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-medium text-muted">Sans date ({unplanned.length}) — ajoutez un début ou une échéance pour les placer :</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {unplanned.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => open(t.id)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
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
