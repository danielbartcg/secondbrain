"use client";

import { useEffect, useRef } from "react";

/**
 * Enveloppe générique amCharts 4 (règle du projet : tout graphique passe par
 * amCharts 4). Le module manipule `window` : import dynamique côté client,
 * instance détruite au démontage ou au changement de données.
 *
 * `build` reçoit les modules et le conteneur, construit le graphique et le
 * renvoie (pour disposal). Les couleurs du thème sont résolues via
 * `themeColor()` : amCharts ne sait pas interpréter `var(--…)`.
 */

export type Am4Core = typeof import("@amcharts/amcharts4/core");
export type Am4Charts = typeof import("@amcharts/amcharts4/charts");
type Disposable = { dispose(): void };

export function themeColor(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

/**
 * Licence commerciale amCharts 4 (même clé partout : graphiques « CH » et
 * cartes « MP ») : retire le logo amCharts. Appliquée une fois, à la première
 * construction d'un graphique, par l'enveloppe — tout graphique y passe.
 */
export const AMCHARTS_LICENSES = ["CH214458775", "MP214458775"] as const;
let licensed = false;
export function applyLicense(am4core: Am4Core) {
  if (licensed) return;
  for (const key of AMCHARTS_LICENSES) am4core.addLicense(key);
  licensed = true;
}

export const PALETTE = ["#4f5ff0", "#1f9d55", "#d98a0b", "#d13b3b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b"];

/** Réglages communs : licence, police, taille. */
export function applyBaseTheme(am4core: Am4Core, chart: { fontFamily?: string; fontSize?: number }) {
  applyLicense(am4core);
  am4core.options.autoDispose = true;
  chart.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  chart.fontSize = 12;
}

export function AmChart({
  build,
  deps,
  height = 280,
  className = "",
  empty,
}: {
  build: (am4core: Am4Core, am4charts: Am4Charts, container: HTMLDivElement) => Disposable;
  /** Le graphique est reconstruit quand ces valeurs changent. */
  deps: unknown[];
  height?: number;
  className?: string;
  /** Message affiché à la place du graphique si défini. */
  empty?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (empty) return;
    let disposed = false;
    let instance: Disposable | null = null;
    const dark = document.documentElement.dataset.theme === "dark";
    Promise.all([import("@amcharts/amcharts4/core"), import("@amcharts/amcharts4/charts"), dark ? import("@amcharts/amcharts4/themes/dark") : Promise.resolve(null)]).then(([am4core, am4charts, darkTheme]) => {
      if (disposed || !ref.current) return;
      applyLicense(am4core);
      // Thème « sombre » de l'application : thème sombre amCharts (textes clairs).
      am4core.unuseAllThemes();
      if (darkTheme) am4core.useTheme(darkTheme.default);
      instance = build(am4core, am4charts, ref.current);
    });
    return () => {
      disposed = true;
      instance?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, ...deps]);

  if (empty) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-dashed border-line-strong text-sm text-muted ${className}`} style={{ height }}>
        {empty}
      </div>
    );
  }
  return <div ref={ref} className={className} style={{ width: "100%", height }} />;
}
