"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RiskDto } from "@/lib/risks";
import { RISK_LEVELS, RISK_STATUS_LABEL, levelLabel, type RiskKindValue } from "@/lib/shared/risks";
import { LEVEL_COLORS, LevelBadge, RiskMatrix, type MatrixCell } from "./RiskMatrix";

export type BoardRisk = RiskDto & { projectName?: string; projectColor?: string | null; changedSince?: boolean; deletedSince?: boolean };

/**
 * Matrice 5 × 5 + synthèse par niveau + registre (références R1, R2… par
 * criticité décroissante) : visuel commun au tableau de bord (« Matrice des
 * risques ») et au voyage dans le temps. Un clic sur une case filtre le
 * registre ; une référence de la matrice le fait défiler jusqu'à la ligne.
 * Les éléments clos restent dans le registre (en fin de liste) mais pas dans
 * la matrice ni la synthèse.
 */
export function RiskBoard({
  risks,
  kind = "RISK",
  hrefOf,
  showProject = false,
  showOwner = false,
  emptyText,
}: {
  risks: BoardRisk[];
  kind?: RiskKindValue;
  hrefOf: (r: BoardRisk) => string;
  showProject?: boolean;
  showOwner?: boolean;
  emptyText: string;
}) {
  const [cell, setCell] = useState<MatrixCell | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const sorted = useMemo(
    () => [...risks].sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED") || b.score - a.score || a.title.localeCompare(b.title, "fr")),
    [risks],
  );
  const refs = useMemo(() => new Map(sorted.map((r, i) => [r.id, `${kind === "OPPORTUNITY" ? "O" : "R"}${i + 1}`])), [sorted, kind]);
  const open = sorted.filter((r) => r.status !== "CLOSED");
  const shown = cell ? open.filter((r) => r.probability === cell.probability && r.impact === cell.impact) : sorted;

  function focusItem(id: string) {
    setCell(null);
    setFocused(id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-risk="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div>
        <RiskMatrix kind={kind} items={sorted} refs={refs} selected={cell} onSelectCell={setCell} onSelectItem={focusItem} />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[...RISK_LEVELS].reverse().map((l) => (
            <div key={l} className="rounded-xl border border-line p-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLORS[kind][l].bg }} />
                {levelLabel(kind, l)}
              </div>
              <div className="text-lg font-semibold tabular-nums">{open.filter((r) => r.level === l).length}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{cell ? `Case probabilité ${cell.probability} × ${kind === "OPPORTUNITY" ? "bénéfice" : "gravité"} ${cell.impact}` : "Registre"}</h3>
          {cell && (
            <button type="button" onClick={() => setCell(null)} className="text-xs font-medium text-brand-600 hover:underline">
              Tout afficher
            </button>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">{emptyText}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">Rien dans cette case.</p>
        ) : (
          <ul ref={listRef} className="max-h-[26rem] divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {shown.map((r) => (
              <li key={r.id} data-risk={r.id} className={`${focused === r.id ? "bg-brand-50" : ""} ${r.status === "CLOSED" ? "opacity-60" : ""}`}>
                <Link href={hrefOf(r)} className="flex items-start gap-2.5 px-3 py-2 hover:bg-surface-2">
                  <span className="mt-0.5 shrink-0 rounded bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums text-ink-2">{refs.get(r.id)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      {showProject && r.projectName && (
                        <>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.projectColor ?? "var(--color-brand-600)" }} aria-hidden />
                          <span className="max-w-[12rem] truncate">{r.projectName}</span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <span className="shrink-0">{RISK_STATUS_LABEL[r.status]}</span>
                      {showOwner && r.ownerName && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="max-w-[10rem] truncate">{r.ownerName}</span>
                        </>
                      )}
                      {r.deletedSince ? (
                        <span className="shrink-0 font-medium text-danger">· supprimé depuis</span>
                      ) : r.changedSince ? (
                        <span className="shrink-0 font-medium text-amber-700">· modifié depuis</span>
                      ) : null}
                    </span>
                  </span>
                  <LevelBadge kind={kind} score={r.score} level={r.level} label={r.levelLabel} compact />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
