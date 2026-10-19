"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/client";
import type { RiskOverview, RiskOverviewScope } from "@/lib/risks";
import { RISK_LEVELS, RISK_LEVEL_LABEL, RISK_STATUS_LABEL } from "@/lib/shared/risks";
import { LEVEL_COLORS, LevelBadge, RiskMatrix, type MatrixCell } from "@/components/projects/risks/RiskMatrix";

const SCOPE_KEY = "sb.dashboard.riskScope";
const SCOPE_LABEL: Record<RiskOverviewScope, string> = { mine: "Risques dont je suis propriétaire", projects: "Tous les risques de mes projets" };

function readScope(): RiskOverviewScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "projects" ? "projects" : "mine";
  } catch {
    return "mine";
  }
}

/**
 * Tableau de bord — matrice des risques (même format que l'onglet Risques
 * d'un projet) : risques non clos dont je suis responsable, ou, si je possède
 * au moins un projet, tous les risques de mes projets (bascule mémorisée sur
 * l'appareil). Un clic sur une case filtre la liste ; une référence ouvre le
 * registre du projet. En ligne : masqué si le serveur est injoignable.
 */
export function RisksPanel() {
  const [scope, setScope] = useState<RiskOverviewScope>("mine");
  const [data, setData] = useState<RiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [cell, setCell] = useState<MatrixCell | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setScope(readScope()), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<{ overview: RiskOverview }>(`/me/risks?scope=${scope}`)
      .then((r) => {
        if (!alive) return;
        setData(r.overview);
        setCell(null);
        setFocused(null);
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope]);

  const risks = useMemo(() => data?.risks ?? [], [data]);
  const refs = useMemo(() => new Map(risks.map((r, i) => [r.id, `R${i + 1}`])), [risks]);
  const shown = cell ? risks.filter((r) => r.probability === cell.probability && r.impact === cell.impact) : risks;

  function pick(next: RiskOverviewScope) {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* préférence non mémorisée */
    }
  }

  function focusItem(id: string) {
    setCell(null);
    setFocused(id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-risk="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  if (!data && !loading) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-5 w-5 text-red-500" /> Matrice des risques
          {data && <span className="text-sm font-normal text-muted">{data.risks.length} risque{data.risks.length > 1 ? "s" : ""} ouvert{data.risks.length > 1 ? "s" : ""}</span>}
        </h2>
        {data?.ownsProjects && (
          <div className="inline-flex max-w-full rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Risques affichés">
            {(["mine", "projects"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => pick(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${scope === s ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {data?.ownsProjects ? SCOPE_LABEL[scope] : SCOPE_LABEL.mine} · risques non clos des projets actifs ou en pause
      </p>

      {data && (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <RiskMatrix kind="RISK" items={risks} refs={refs} selected={cell} onSelectCell={setCell} onSelectItem={focusItem} />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[...RISK_LEVELS].reverse().map((l) => {
                const n = risks.filter((r) => r.level === l).length;
                return (
                  <div key={l} className="rounded-xl border border-line p-2 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLORS.RISK[l].bg }} />
                      {RISK_LEVEL_LABEL[l]}
                    </div>
                    <div className="text-lg font-semibold tabular-nums">{n}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{cell ? `Case probabilité ${cell.probability} × gravité ${cell.impact}` : "Registre"}</h3>
              {cell && (
                <button type="button" onClick={() => setCell(null)} className="text-xs font-medium text-brand-600 hover:underline">
                  Tout afficher
                </button>
              )}
            </div>
            {risks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
                {scope === "projects" && data.ownsProjects ? "Aucun risque ouvert dans vos projets." : "Aucun risque ouvert dont vous êtes responsable."}
              </p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted">Aucun risque dans cette case.</p>
            ) : (
              <ul ref={listRef} className="max-h-[26rem] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {shown.map((r) => (
                  <li key={r.id} data-risk={r.id} className={focused === r.id ? "bg-brand-50" : undefined}>
                    <Link href={`/projects/${r.projectId}#risks`} className="flex items-start gap-2.5 px-3 py-2 hover:bg-surface-2">
                      <span className="mt-0.5 shrink-0 rounded bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums text-ink-2">{refs.get(r.id)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.projectColor ?? "var(--color-brand-600)" }} aria-hidden />
                          <span className="truncate">{r.projectName}</span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0">{RISK_STATUS_LABEL[r.status]}</span>
                          {scope === "projects" && r.ownerName && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate">{r.ownerName}</span>
                            </>
                          )}
                        </span>
                      </span>
                      <LevelBadge kind="RISK" score={r.score} level={r.level} label={r.levelLabel} compact />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
