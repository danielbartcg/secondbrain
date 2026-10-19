"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Info, Loader2 } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import type { ProjectAt } from "@/lib/time-travel";
import { ProgressCurveChart } from "@/components/charts/ProgressCurveChart";
import { TimeTravelGantt, TimeTravelRisks } from "./TimeTravelPanels";
import { parisYmd } from "@/lib/shared/activity-period";
import { Badge, PRIORITY_LABEL, ProgressBar, TASK_STATUS_LABEL, TASK_STATUS_TONE, errorMessage, formatDate, inputClass } from "@/components/ui";

/**
 * Onglet « Voyage dans le temps » : état du projet à une date passée,
 * reconstitué depuis la piste d'audit des tâches (statut, avancement, dates,
 * priorité, responsable, nom). Courbe d'avancement cliquable, curseur de date,
 * indicateurs, avancement par étape, Gantt à la date (ou actuel comparé),
 * matrice des risques / opportunités à la date (instantanés `RiskSnapshot`)
 * et tâches telles qu'elles étaient. En ligne uniquement.
 */

const DAY_MS = 86_400_000;
/** Jour (calendrier de Paris) : les dates choisies sont interprétées à Paris. */
const ymd = (d: Date) => parisYmd(d);
const QUICK = [
  { label: "Il y a 7 j", days: 7 },
  { label: "30 j", days: 30 },
  { label: "90 j", days: 90 },
];

export function ProjectTimeTravelTab({ project }: { project: ProjectDto }) {
  const today = useMemo(() => ymd(new Date()), []);
  const first = ymd(new Date(project.createdAt));
  const [date, setDate] = useState(() => ymd(new Date(Math.max(new Date(project.createdAt).getTime(), Date.now() - 7 * DAY_MS))));
  const [state, setState] = useState<ProjectAt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      api
        .get<{ state: ProjectAt }>(`/projects/${project.id}/time-travel?at=${date}`)
        .then((r) => alive && setState(r.state))
        .catch((e) => alive && setError(errorMessage(e, "Disponible uniquement en ligne.")))
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [project.id, date, project.updatedAt]);

  const pick = useCallback((iso: string) => setDate(iso.slice(0, 10) > today ? today : iso.slice(0, 10) < first ? first : iso.slice(0, 10)), [today, first]);

  const span = Math.max(1, Math.round((new Date(today).getTime() - new Date(first).getTime()) / DAY_MS));
  const offset = Math.round((new Date(date).getTime() - new Date(first).getTime()) / DAY_MS);
  const tasks = state ? (onlyChanged ? state.tasks.filter((t) => t.changedSince) : state.tasks) : [];
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <History className="h-5 w-5 text-brand-600" /> Voyage dans le temps
      </h2>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          L&apos;état du projet à la date choisie, reconstitué depuis l&apos;historique des tâches (statut, avancement, dates, priorité, responsable, nom) et
          des risques. Les tâches supprimées depuis n&apos;apparaissent plus ; les étapes gardent leur nom actuel. Les risques sont historisés depuis le
          19/10/2026 (avant : leur état à cette date-là).
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="tt-date" className="text-sm font-medium">
          Au
        </label>
        <input id="tt-date" type="date" min={first} max={today} value={date} onChange={(e) => e.target.value && pick(e.target.value)} className={`${inputClass} w-44`} />
        {QUICK.map((q) => (
          <button
            key={q.days}
            type="button"
            onClick={() => pick(ymd(new Date(Date.now() - q.days * DAY_MS)))}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 md:py-1"
          >
            {q.label}
          </button>
        ))}
        <button type="button" onClick={() => pick(first)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 md:py-1">
          Création
        </button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>
      <input
        type="range"
        min={0}
        max={span}
        value={Math.max(0, Math.min(span, offset))}
        onChange={(e) => pick(ymd(new Date(new Date(first).getTime() + Number(e.target.value) * DAY_MS)))}
        className="mt-3 w-full accent-brand-600"
        aria-label="Date consultée"
      />
      <div className="flex justify-between text-[11px] text-muted">
        <span>{formatDate(first)}</span>
        <span>Aujourd&apos;hui</span>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

      {state && (
        <>
          <div className="mt-4">
            <ProgressCurveChart points={state.curve} selected={state.at} onPick={pick} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Avancement" value={`${state.stats.percent} %`} />
            <Stat label="Tâches" value={state.stats.total} />
            <Stat label="Terminées" value={state.stats.done} />
            <Stat label="En cours" value={state.stats.inProgress} />
            <Stat label="En retard" value={state.stats.late} tone={state.stats.late ? "danger" : undefined} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Depuis le {formatDate(date)} : {state.since.created} tâche{state.since.created > 1 ? "s" : ""} créée{state.since.created > 1 ? "s" : ""},{" "}
            {state.since.changed} modifiée{state.since.changed > 1 ? "s" : ""}.
          </p>

          {state.stages.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Avancement par étape</h3>
              <ul className="mt-2 space-y-2">
                {state.stages.map((s) => (
                  <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[14rem_minmax(0,1fr)_6rem]">
                    <span className="truncate text-sm" title={s.name}>
                      {s.name}
                    </span>
                    <span className="text-right text-xs tabular-nums text-muted sm:order-last">
                      {s.done}/{s.total} · {s.percent} %
                    </span>
                    <ProgressBar percent={s.percent} className="col-span-2 sm:col-span-1" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TimeTravelGantt project={project} state={state} date={date} />

          <TimeTravelRisks project={project} risks={state.risks} date={date} />

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Tâches au {formatDate(date)}</h3>
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-600)]" />
                Seulement celles modifiées depuis
              </label>
            </div>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Aucune tâche à cette date.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 pr-2 font-medium">Tâche</th>
                      <th className="py-1.5 pr-2 font-medium">Statut</th>
                      <th className="py-1.5 pr-2 text-right font-medium">%</th>
                      <th className="py-1.5 pr-2 font-medium">Échéance</th>
                      <th className="py-1.5 pr-2 font-medium">Priorité</th>
                      <th className="py-1.5 font-medium">Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.slice(0, 300).map((t) => (
                      <tr key={t.id} className="border-t border-line">
                        <td className="max-w-[18rem] py-1.5 pr-2">
                          <Link href={`/tasks/${t.id}`} className="block truncate hover:text-brand-700" title={t.name}>
                            {t.name}
                          </Link>
                          <span className="block truncate text-xs text-muted">
                            {t.stageId ? stageName.get(t.stageId) : "Sans étape"}
                            {t.changedSince && " · modifiée depuis"}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge tone={TASK_STATUS_TONE[t.status as keyof typeof TASK_STATUS_TONE] ?? "neutral"}>{TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}</Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{t.progress}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-ink-2">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                        <td className="py-1.5 pr-2 text-ink-2">{PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL] ?? t.priority}</td>
                        <td className="py-1.5 text-ink-2">{t.assignee ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tasks.length > 300 && <p className="mt-2 text-xs text-muted">300 premières tâches affichées sur {tasks.length}.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}
