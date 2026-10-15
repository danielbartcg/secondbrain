"use client";

import { memo, useId } from "react";
import type { Link } from "./ganttModel";

/**
 * Liens de dépendance fin → début, en surimpression SVG de la frise :
 * tracé orthogonal aux coins arrondis, pointe de flèche à l'entrée de la
 * tâche ; conflit (le prérequis finit après le début) en pointillé rouge ;
 * liens de la tâche survolée ou sélectionnée mis en avant.
 */
export const GanttConnectors = memo(function GanttConnectors({
  links,
  width,
  height,
  focusId,
}: {
  links: Link[];
  width: number;
  height: number;
  focusId: string | null;
}) {
  const uid = useId().replace(/:/g, "");
  const marker = (kind: "n" | "c" | "h") => `url(#gantt-arrow-${kind}-${uid})`;
  const normal: Link[] = [];
  const focused: Link[] = [];
  for (const l of links) (focusId && (l.from === focusId || l.to === focusId) ? focused : normal).push(l);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={width}
      height={height}
      style={{ zIndex: 2 }}
    >
      <defs>
        {(
          [
            ["n", "var(--color-muted)"],
            ["c", "var(--color-danger)"],
            ["h", "var(--color-brand-500)"],
          ] as const
        ).map(([k, color]) => (
          <marker key={k} id={`gantt-arrow-${k}-${uid}`} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0.5 L8,4 L0,7.5 Z" style={{ fill: color }} />
          </marker>
        ))}
      </defs>
      {normal.map((l) => (
        <path
          key={`${l.from}>${l.to}`}
          d={l.d}
          fill="none"
          strokeWidth={1.4}
          strokeDasharray={l.conflict ? "4 3" : undefined}
          markerEnd={marker(l.conflict ? "c" : "n")}
          style={{ stroke: l.conflict ? "var(--color-danger)" : "var(--color-muted)", opacity: focusId ? 0.45 : 0.9 }}
        />
      ))}
      {focused.map((l) => (
        <path
          key={`${l.from}>${l.to}`}
          d={l.d}
          fill="none"
          strokeWidth={2}
          strokeDasharray={l.conflict ? "4 3" : undefined}
          markerEnd={marker(l.conflict ? "c" : "h")}
          style={{ stroke: l.conflict ? "var(--color-danger)" : "var(--color-brand-500)" }}
        />
      ))}
    </svg>
  );
});
