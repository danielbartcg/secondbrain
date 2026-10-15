"use client";

import type { RiskDto } from "@/lib/risks";
import {
  BENEFIT_LABELS,
  OPPORTUNITY_LEVEL_LABEL,
  PROBABILITY_LABELS,
  RISK_LEVEL_LABEL,
  RISK_LEVELS,
  SEVERITY_LABELS,
  riskLevel,
  type RiskKindValue,
  type RiskLevel,
} from "@/lib/shared/risks";

/**
 * Palette volontairement fixe (indépendante du thème) : fonds saturés et
 * texte foncé / blanc choisis pour rester lisibles en thème clair comme sombre.
 * Risques : vert → jaune → orange → rouge. Opportunités : sarcelle clair → foncé.
 */
export const LEVEL_COLORS: Record<RiskKindValue, Record<RiskLevel, { bg: string; fg: string }>> = {
  RISK: {
    low: { bg: "#4ade80", fg: "#052e16" },
    medium: { bg: "#facc15", fg: "#422006" },
    high: { bg: "#fb923c", fg: "#431407" },
    critical: { bg: "#ef4444", fg: "#ffffff" },
  },
  OPPORTUNITY: {
    low: { bg: "#ccfbf1", fg: "#134e4a" },
    medium: { bg: "#5eead4", fg: "#134e4a" },
    high: { bg: "#14b8a6", fg: "#042f2e" },
    critical: { bg: "#0f766e", fg: "#ffffff" },
  },
};

const LEVEL_RANGE: Record<RiskLevel, string> = { low: "1–4", medium: "5–9", high: "10–15", critical: "16–25" };

/** Pastille « score · niveau » colorée. */
export function LevelBadge({ kind, score, level, label, compact = false }: { kind: RiskKindValue; score: number; level: RiskLevel; label: string; compact?: boolean }) {
  const c = LEVEL_COLORS[kind][level];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={{ backgroundColor: c.bg, color: c.fg }}
      title={`Criticité ${score} / 25 — ${label}`}
    >
      {score}
      {!compact && <span className="font-medium">· {label}</span>}
    </span>
  );
}

export type MatrixCell = { probability: number; impact: number };

/**
 * Matrice 5 × 5 : probabilité en ordonnée (5 en haut), gravité / bénéfice en
 * abscisse. Chaque case affiche le nombre et les références des éléments non
 * clos ; un clic sur la case filtre le tableau, un clic sur une référence
 * désigne la ligne.
 */
export function RiskMatrix({
  kind,
  items,
  refs,
  selected,
  onSelectCell,
  onSelectItem,
}: {
  kind: RiskKindValue;
  items: RiskDto[];
  refs: Map<string, string>;
  selected: MatrixCell | null;
  onSelectCell: (cell: MatrixCell | null) => void;
  onSelectItem: (id: string) => void;
}) {
  const open = items.filter((r) => r.status !== "CLOSED");
  const impactLabels = kind === "OPPORTUNITY" ? BENEFIT_LABELS : SEVERITY_LABELS;
  const impactAxis = kind === "OPPORTUNITY" ? "Bénéfice" : "Gravité";
  const levelLabels = kind === "OPPORTUNITY" ? OPPORTUNITY_LEVEL_LABEL : RISK_LEVEL_LABEL;

  return (
    <div>
      <div className="flex gap-1.5">
        {/* Titre de l'axe vertical */}
        <div className="flex w-4 shrink-0 items-center justify-center">
          <span className="-rotate-90 whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-muted">Probabilité</span>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-1" role="grid" aria-label={`Matrice des ${kind === "OPPORTUNITY" ? "opportunités" : "risques"}`}>
          {[5, 4, 3, 2, 1].map((p) => (
            <MatrixRow key={p}>
              <div className="flex items-center justify-end pr-1 text-right text-[11px] leading-tight text-muted" title={PROBABILITY_LABELS[p - 1]}>
                <span className="font-semibold text-ink-2">{p}</span>
                <span className="ml-1 hidden max-w-[5.5rem] sm:inline">{PROBABILITY_LABELS[p - 1]}</span>
              </div>
              {[1, 2, 3, 4, 5].map((i) => {
                const score = p * i;
                const level = riskLevel(score);
                const c = LEVEL_COLORS[kind][level];
                const here = open.filter((r) => r.probability === p && r.impact === i);
                const isSel = selected?.probability === p && selected.impact === i;
                return (
                  <div
                    key={i}
                    role="gridcell"
                    tabIndex={0}
                    aria-selected={isSel}
                    aria-label={`Probabilité ${p}, ${impactAxis.toLowerCase()} ${i} : ${here.length} élément(s)`}
                    onClick={() => onSelectCell(isSel ? null : { probability: p, impact: i })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectCell(isSel ? null : { probability: p, impact: i });
                      }
                    }}
                    className={`relative flex min-h-12 cursor-pointer flex-col rounded-md p-1 transition sm:min-h-16 sm:p-1.5 ${
                      isSel ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "hover:brightness-95"
                    } ${here.length === 0 ? "opacity-55" : ""}`}
                    style={{ backgroundColor: c.bg, color: c.fg }}
                    title={`${PROBABILITY_LABELS[p - 1]} × ${impactLabels[i - 1]} — criticité ${score} (${levelLabels[level]})`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[10px] font-medium opacity-70 tabular-nums">{score}</span>
                      {here.length > 0 && <span className="text-sm font-bold leading-none tabular-nums">{here.length}</span>}
                    </div>
                    {here.length > 0 && (
                      <div className="mt-auto flex flex-wrap gap-0.5">
                        {here.slice(0, 6).map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectItem(r.id);
                            }}
                            title={r.title}
                            className="rounded px-1 text-[10px] font-semibold leading-4 hover:underline"
                            style={{ backgroundColor: "rgba(255,255,255,0.72)", color: "#111827" }}
                          >
                            {refs.get(r.id)}
                          </button>
                        ))}
                        {here.length > 6 && <span className="text-[10px] font-semibold">+{here.length - 6}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </MatrixRow>
          ))}
          {/* Axe horizontal */}
          <div />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="pt-0.5 text-center text-[11px] leading-tight text-muted" title={impactLabels[i - 1]}>
              <span className="font-semibold text-ink-2">{i}</span>
              <span className="hidden sm:block">{impactLabels[i - 1]}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted">{impactAxis}</p>

      {/* Légende */}
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-2">
        {RISK_LEVELS.map((l) => (
          <li key={l} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: LEVEL_COLORS[kind][l].bg }} />
            {levelLabels[l]} <span className="text-muted">({LEVEL_RANGE[l]})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatrixRow({ children }: { children: React.ReactNode }) {
  return <div className="contents" role="row">{children}</div>;
}
