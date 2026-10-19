"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

/**
 * Évolution d'un bloc du journal (colonnes par jour) — amCharts 4 XYChart :
 * mots saisis par jour (blocs rédigés) ou nombre d'actions (bloc Activité).
 * Un clic sur une colonne appelle `onPick` avec le jour.
 */
export function JournalTrendChart({ series, unit, color = "#4f5ff0", height = 180, onPick }: { series: { day: string; value: number }[]; unit: string; color?: string; height?: number; onPick?: (day: string) => void }) {
  const total = series.reduce((a, d) => a + d.value, 0);
  const data = series.map((d) => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` }));
  return (
    <AmChart
      height={height}
      deps={[JSON.stringify(data), unit, color]}
      empty={total === 0 ? "Aucune saisie sur la période" : null}
      build={(am4core, am4charts, container) => {
        const chart = am4core.create(container, am4charts.XYChart);
        applyBaseTheme(am4core, chart);
        chart.data = data;
        chart.paddingTop = 8;
        chart.paddingRight = 4;
        const ink = am4core.color(themeColor("--color-muted", "#6d6c72"));
        const grid = am4core.color(themeColor("--color-line", "#e7e5e0"));

        const x = chart.xAxes.push(new am4charts.CategoryAxis());
        x.dataFields.category = "label";
        x.renderer.grid.template.disabled = true;
        x.renderer.labels.template.fill = ink;
        x.renderer.labels.template.fontSize = 11;
        x.renderer.minGridDistance = 32;
        x.renderer.cellStartLocation = 0.15;
        x.renderer.cellEndLocation = 0.85;

        const y = chart.yAxes.push(new am4charts.ValueAxis());
        y.min = 0;
        y.maxPrecision = 0;
        y.renderer.labels.template.fill = ink;
        y.renderer.labels.template.fontSize = 11;
        y.renderer.grid.template.stroke = grid;
        y.renderer.grid.template.strokeOpacity = 1;

        const s = chart.series.push(new am4charts.ColumnSeries());
        s.dataFields.categoryX = "label";
        s.dataFields.valueY = "value";
        s.fill = am4core.color(color);
        s.stroke = am4core.color(color);
        s.columns.template.width = am4core.percent(100);
        s.columns.template.column.cornerRadiusTopLeft = 3;
        s.columns.template.column.cornerRadiusTopRight = 3;
        s.columns.template.tooltipText = `{categoryX} : [bold]{valueY}[/] ${unit}`;
        if (onPick) {
          s.columns.template.cursorOverStyle = am4core.MouseCursorStyle.pointer;
          s.columns.template.events.on("hit", (ev) => {
            const d = (ev.target.dataItem?.dataContext as { day?: string } | undefined)?.day;
            if (d) onPick(d);
          });
        }
        return chart;
      }}
    />
  );
}
