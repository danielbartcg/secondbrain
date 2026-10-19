"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ShieldAlert } from "lucide-react";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import type { ProjectAt, TimeRisk } from "@/lib/time-travel";
import type { RiskKindValue } from "@/lib/shared/risks";
import { GanttView } from "@/components/gantt/GanttView";
import { baselineSpans, taskSpan, type GProject, type GTask, type GanttScale } from "@/components/gantt/ganttModel";
import { RiskBoard } from "./risks/RiskBoard";
import { formatDate } from "@/components/ui";

/**
 * Voyage dans le temps — Gantt et risques à la date choisie.
 *
 * Gantt : structure actuelle du plan (étapes, activités) peuplée des tâches
 * qui existaient à cette date, avec leurs dates, statut et avancement
 * reconstitués ; les étapes prennent l'étendue de leurs tâches (pas
 * d'historique des dates d'étape). Mode « Aujourd'hui comparé » : le Gantt
 * actuel avec la version passée en barres fantômes (glissements). Lecture
 * seule.
 */

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export function ganttAt(project: ProjectDto, state: ProjectAt): GProject {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const stagesAt = new Map(state.stages.map((s) => [s.id, s]));
  const keep = (ts: TaskDto[]): GTask[] =>
    ts
      .filter((t) => byId.has(t.id))
      .map((t) => {
        const s = byId.get(t.id)!;
        return { id: t.id, name: s.name, status: s.status, progress: s.progress, startDate: s.startDate, dueDate: s.dueDate, prerequisiteIds: (t.prerequisiteIds ?? []).filter((id) => byId.has(id)) };
      });
  return {
    stages: project.stages
      .filter((s) => stagesAt.has(s.id))
      .map((s) => {
        const activities = s.activities.map((a) => {
          const tasks = keep(a.tasks);
          return { id: a.id, name: a.name, progress: { percent: avg(tasks.map((t) => t.progress)) }, tasks };
        });
        return { id: s.id, name: s.name, startDate: null, dueDate: null, progress: { percent: stagesAt.get(s.id)!.percent }, activities, tasks: keep(s.tasks) };
      }),
    tasks: keep(project.tasks),
  };
}

const SCALES: { key: GanttScale; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

const noop = async () => {};

export function TimeTravelGantt({ project, state, date }: { project: ProjectDto; state: ProjectAt; date: string }) {
  const router = useRouter();
  const [scale, setScale] = useState<GanttScale>("week");
  const [compare, setCompare] = useState(false);
  const past = useMemo(() => ganttAt(project, state), [project, state]);
  const pastSpans = useMemo(
    () =>
      baselineSpans({
        stages: past.stages.map((s) => ({ id: s.id, name: s.name, startDate: null, dueDate: null })),
        tasks: state.tasks.map((t) => ({ id: t.id, name: t.name, stageId: t.stageId, startDate: t.startDate, dueDate: t.dueDate })),
      }),
    [past, state.tasks],
  );
  const open = useCallback((id: string) => router.push(`/tasks/${id}`), [router]);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarRange className="h-4 w-4 text-brand-600" /> {compare ? `Gantt actuel comparé au ${formatDate(date)}` : `Gantt au ${formatDate(date)}`}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Version du Gantt">
            {[
              { v: false, label: `Au ${formatDate(date)}` },
              { v: true, label: "Aujourd'hui comparé" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                role="radio"
                aria-checked={compare === o.v}
                onClick={() => setCompare(o.v)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${compare === o.v ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Échelle">
            {SCALES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={scale === s.key}
                onClick={() => setScale(s.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${scale === s.key ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {compare
          ? `Barres pleines : planning actuel ; barres fantômes : planning au ${formatDate(date)}.`
          : "Dates, statut et avancement des tâches tels qu'ils étaient ; les étapes couvrent l'étendue de leurs tâches. Consultation seule."}
      </p>
      <div className="mt-3">
        {!compare && !state.tasks.some((t) => taskSpan(t)) ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">Aucune tâche datée à cette date.</p>
        ) : (
        <GanttView project={compare ? project : past} scale={scale} cascade={false} onCommit={noop} onOpen={open} baseline={compare ? pastSpans : null} readOnly />
        )}
      </div>
    </section>
  );
}

/** Registre des risques / opportunités à la date : même visuel que la matrice du tableau de bord. */
export function TimeTravelRisks({ project, risks, date }: { project: ProjectDto; risks: TimeRisk[]; date: string }) {
  const [kind, setKind] = useState<RiskKindValue>("RISK");
  const list = risks.filter((r) => r.kind === kind);
  const openCount = list.filter((r) => r.status !== "CLOSED").length;
  const count = (k: RiskKindValue) => risks.filter((r) => r.kind === k && r.status !== "CLOSED").length;
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-red-500" /> {kind === "RISK" ? "Matrice des risques" : "Matrice des opportunités"} au {formatDate(date)}
          <span className="font-normal text-muted">
            {openCount} ouvert{openCount > 1 ? "s" : ""}
          </span>
        </h3>
        <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Type">
          {(["RISK", "OPPORTUNITY"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${kind === k ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {k === "RISK" ? "Risques" : "Opportunités"} ({count(k)})
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Registre tel qu&apos;il était à cette date (criticité, statut, responsable) ; « modifié depuis » / « supprimé depuis » signalent les évolutions ultérieures.</p>
      <div className="mt-3">
        <RiskBoard
          key={kind}
          risks={list}
          kind={kind}
          hrefOf={() => `/projects/${project.id}#risques`}
          showOwner
          emptyText={kind === "RISK" ? "Aucun risque déclaré à cette date." : "Aucune opportunité déclarée à cette date."}
        />
      </div>
    </section>
  );
}
