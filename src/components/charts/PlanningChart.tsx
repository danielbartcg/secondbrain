"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

export type PlanningRow = {
  name: string;
  /** ISO. Au moins l'une des deux dates doit être renseignée. */
  start: string | null;
  end: string | null;
  color: string;
  /** 0..100 : partie réalisée (dessinée en plein, le reste en clair). */
  percent?: number;
  kind: "stage" | "deliverable";
  detail?: string;
};

const DAY = 24 * 60 * 60 * 1000;

/** Planning (Gantt) des étapes et livrables — amCharts 4 XYChart avec DateAxis. */
export function PlanningChart({ rows, height }: { rows: PlanningRow[]; height?: number }) {
  const data = rows
    .filter((r) => r.start || r.end)
    .map((r) => {
      const start = new Date(r.start ?? r.end!);
      let end = new Date(r.end ?? r.start!);
      if (end.getTime() - start.getTime() < DAY) end = new Date(start.getTime() + DAY);
      const pct = Math.max(0, Math.min(100, r.percent ?? 0));
      const doneEnd = new Date(start.getTime() + ((end.getTime() - start.getTime()) * pct) / 100);
      return {
        name: `${r.kind === "deliverable" ? "📦 " : ""}${r.name}`,
        start,
        end,
        doneStart: start,
        doneEnd,
        color: r.color,
        percent: pct,
        detail: r.detail ?? "",
        opacity: r.kind === "deliverable" ? 0.55 : 0.35,
      };
    });
  const unplanned = rows.length - data.length;
  const h = height ?? Math.max(180, 70 + data.length * 36);

  return (
    <div>
      <AmChart
        height={h}
        deps={[JSON.stringify(data)]}
        empty={data.length === 0 ? "Renseignez des dates de début / échéance sur les étapes ou les livrables pour afficher le planning." : null}
        build={(am4core, am4charts, container) => {
          const chart = am4core.create(container, am4charts.XYChart);
          applyBaseTheme(am4core, chart);
          chart.data = data;
          chart.paddingRight = 24;
          chart.paddingLeft = 0;

          const ink2 = am4core.color(themeColor("--color-ink-2", "#3b3b40"));
          const muted = am4core.color(themeColor("--color-muted", "#6d6c72"));
          const line = am4core.color(themeColor("--color-line", "#e3e1db"));
          const danger = am4core.color(themeColor("--color-danger", "#d13b3b"));

          const catAxis = chart.yAxes.push(new am4charts.CategoryAxis());
          catAxis.dataFields.category = "name";
          catAxis.renderer.inversed = true;
          catAxis.renderer.grid.template.location = 0;
          catAxis.renderer.grid.template.stroke = line;
          catAxis.renderer.minGridDistance = 10;
          catAxis.renderer.labels.template.fill = ink2;
          catAxis.renderer.labels.template.fontSize = 12;
          catAxis.renderer.labels.template.truncate = true;
          catAxis.renderer.labels.template.maxWidth = 170;
          catAxis.renderer.labels.template.tooltipText = "{category}";

          const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
          dateAxis.baseInterval = { count: 1, timeUnit: "day" };
          dateAxis.renderer.minGridDistance = 70;
          dateAxis.renderer.labels.template.fill = muted;
          dateAxis.renderer.labels.template.fontSize = 11;
          dateAxis.renderer.grid.template.stroke = line;
          dateAxis.dateFormats.setKey("day", "dd MMM");
          dateAxis.periodChangeDateFormats.setKey("day", "dd MMM");
          dateAxis.dateFormats.setKey("week", "dd MMM");
          dateAxis.periodChangeDateFormats.setKey("week", "dd MMM");
          dateAxis.dateFormats.setKey("month", "MMM yyyy");
          dateAxis.periodChangeDateFormats.setKey("month", "MMM yyyy");
          // Libellés de dates en français (chargement différé du dictionnaire).
          void import("@amcharts/amcharts4/lang/fr_FR").then((mod) => {
            if (!chart.isDisposed()) chart.language.locale = mod.default;
          });

          // Barre prévisionnelle (claire)
          const planned = chart.series.push(new am4charts.ColumnSeries());
          planned.dataFields.openDateX = "start";
          planned.dataFields.dateX = "end";
          planned.dataFields.categoryY = "name";
          planned.columns.template.propertyFields.fill = "color";
          planned.columns.template.propertyFields.fillOpacity = "opacity";
          planned.columns.template.strokeOpacity = 0;
          planned.columns.template.height = am4core.percent(60);
          planned.columns.template.column.cornerRadius(5, 5, 5, 5);
          planned.columns.template.tooltipText =
            "[bold]{categoryY}[/]\n{openDateX.formatDate('dd/MM/yyyy')} → {dateX.formatDate('dd/MM/yyyy')}\nAvancement : {percent} %\n{detail}";

          // Partie réalisée (pleine)
          const done = chart.series.push(new am4charts.ColumnSeries());
          done.dataFields.openDateX = "doneStart";
          done.dataFields.dateX = "doneEnd";
          done.dataFields.categoryY = "name";
          done.columns.template.propertyFields.fill = "color";
          done.columns.template.strokeOpacity = 0;
          done.columns.template.height = am4core.percent(60);
          done.columns.template.column.cornerRadius(5, 5, 5, 5);
          done.columns.template.tooltipText = "{categoryY} : {percent} % réalisé";

          // Ligne « aujourd'hui »
          const today = dateAxis.axisRanges.create();
          today.date = new Date();
          today.grid.stroke = danger;
          today.grid.strokeWidth = 2;
          today.grid.strokeOpacity = 0.9;
          today.grid.strokeDasharray = "4,3";
          today.label.text = "Aujourd'hui";
          today.label.fill = danger;
          today.label.fontSize = 11;
          today.label.inside = true;
          today.label.valign = "top";
          today.label.horizontalCenter = "left";
          today.label.dx = 4;

          chart.cursor = new am4charts.XYCursor();
          chart.cursor.behavior = "none";
          chart.cursor.lineY.disabled = true;
          return chart;
        }}
      />
      {unplanned > 0 && data.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {unplanned} élément{unplanned > 1 ? "s" : ""} sans date, non affiché{unplanned > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}
