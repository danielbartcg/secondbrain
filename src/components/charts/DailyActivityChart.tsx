"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

export type DailyActivity = { day: string; tasks: number; maps: number; other: number };

const SERIES = [
  { field: "tasks", label: "Tâches", color: "#4f5ff0" },
  { field: "maps", label: "Cartes mentales", color: "#8b5cf6" },
  { field: "other", label: "Réunions, risques, livrables, documents", color: "#d98a0b" },
] as const;

/** Activité par jour (colonnes empilées) — amCharts 4 XYChart. */
export function DailyActivityChart({ days, height = 220 }: { days: DailyActivity[]; height?: number }) {
  const total = days.reduce((a, d) => a + d.tasks + d.maps + d.other, 0);
  const data = days.map((d) => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` }));
  return (
    <AmChart
      height={height}
      deps={[JSON.stringify(data)]}
      empty={total === 0 ? "Aucune activité sur la période" : null}
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
        x.renderer.minGridDistance = 28;
        x.renderer.cellStartLocation = 0.15;
        x.renderer.cellEndLocation = 0.85;

        const y = chart.yAxes.push(new am4charts.ValueAxis());
        y.min = 0;
        y.maxPrecision = 0;
        y.renderer.labels.template.fill = ink;
        y.renderer.labels.template.fontSize = 11;
        y.renderer.grid.template.stroke = grid;
        y.renderer.grid.template.strokeOpacity = 1;

        for (const s of SERIES) {
          const series = chart.series.push(new am4charts.ColumnSeries());
          series.dataFields.categoryX = "label";
          series.dataFields.valueY = s.field;
          series.name = s.label;
          series.stacked = true;
          series.fill = am4core.color(s.color);
          series.stroke = am4core.color(s.color);
          series.columns.template.width = am4core.percent(100);
          series.columns.template.tooltipText = "{categoryX} — {name} : [bold]{valueY}[/]";
        }

        chart.legend = new am4charts.Legend();
        chart.legend.position = "bottom";
        chart.legend.fontSize = 12;
        chart.legend.labels.template.fill = am4core.color(themeColor("--color-ink-2", "#3b3b40"));
        chart.legend.markers.template.width = 12;
        chart.legend.markers.template.height = 12;
        return chart;
      }}
    />
  );
}
