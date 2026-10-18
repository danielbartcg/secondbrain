"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

export type CurvePoint = { date: string; percent: number; done: number; total: number };

/**
 * Courbe d'avancement dans le temps (voyage dans le temps) — amCharts 4
 * XYChart : avancement moyen (%) et tâches terminées, ligne verticale à la
 * date consultée ; un clic sur le graphique choisit la date (`onPick`).
 */
export function ProgressCurveChart({ points, selected, onPick, height = 220 }: { points: CurvePoint[]; selected: string; onPick?: (iso: string) => void; height?: number }) {
  return (
    <AmChart
      height={height}
      deps={[JSON.stringify(points), selected]}
      empty={points.length < 2 ? "Pas encore d'historique" : null}
      build={(am4core, am4charts, container) => {
        const chart = am4core.create(container, am4charts.XYChart);
        applyBaseTheme(am4core, chart);
        chart.language.locale = { ...chart.language.locale, _decimalSeparator: ",", _thousandSeparator: " " };
        chart.dateFormatter.language = chart.language;
        chart.data = points.map((p) => ({ date: new Date(p.date), percent: p.percent, done: p.done, total: p.total }));
        chart.paddingLeft = 0;
        chart.paddingRight = 8;

        const muted = am4core.color(themeColor("--color-muted", "#6d6c72"));
        const line = am4core.color(themeColor("--color-line", "#e3e1db"));
        const brand = am4core.color(themeColor("--color-brand-600", "#4f5ff0"));
        const ok = am4core.color(themeColor("--color-ok", "#1f9d55"));

        const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
        dateAxis.renderer.labels.template.fill = muted;
        dateAxis.renderer.grid.template.stroke = line;
        dateAxis.renderer.minGridDistance = 70;
        dateAxis.dateFormats.setKey("day", "dd/MM");
        dateAxis.periodChangeDateFormats.setKey("day", "dd/MM/yy");
        dateAxis.dateFormats.setKey("month", "MMM yy");

        const pAxis = chart.yAxes.push(new am4charts.ValueAxis());
        pAxis.min = 0;
        pAxis.max = 100;
        pAxis.strictMinMax = true;
        pAxis.renderer.labels.template.fill = muted;
        pAxis.renderer.labels.template.adapter.add("text", (t) => (t ? `${t} %` : t));
        pAxis.renderer.grid.template.stroke = line;

        const dAxis = chart.yAxes.push(new am4charts.ValueAxis());
        dAxis.min = 0;
        dAxis.renderer.opposite = true;
        dAxis.renderer.grid.template.disabled = true;
        dAxis.renderer.labels.template.fill = muted;

        const s1 = chart.series.push(new am4charts.LineSeries());
        s1.name = "Avancement moyen";
        s1.dataFields.dateX = "date";
        s1.dataFields.valueY = "percent";
        s1.yAxis = pAxis;
        s1.stroke = brand;
        s1.fill = brand;
        s1.fillOpacity = 0.12;
        s1.strokeWidth = 2;
        s1.tooltipText = "{dateX.formatDate('dd/MM/yyyy')} : [bold]{valueY} %[/] — {done}/{total} terminées";

        const s2 = chart.series.push(new am4charts.StepLineSeries());
        s2.name = "Tâches terminées";
        s2.dataFields.dateX = "date";
        s2.dataFields.valueY = "done";
        s2.yAxis = dAxis;
        s2.stroke = ok;
        s2.strokeWidth = 1.5;
        s2.strokeDasharray = "4,3";

        const range = dateAxis.axisRanges.create();
        range.date = new Date(selected);
        range.grid.stroke = am4core.color(themeColor("--color-danger", "#d13b3b"));
        range.grid.strokeWidth = 2;
        range.grid.strokeOpacity = 0.9;
        range.label.text = "Consulté";
        range.label.fill = range.grid.stroke;
        range.label.inside = true;
        range.label.valign = "top";
        range.label.fontSize = 10;

        chart.cursor = new am4charts.XYCursor();
        chart.cursor.lineY.disabled = true;
        chart.cursor.behavior = "none";
        if (onPick) {
          chart.plotContainer.cursorOverStyle = am4core.MouseCursorStyle.pointer;
          chart.plotContainer.events.on("hit", () => {
            const pos = chart.cursor.xPosition;
            const d = dateAxis.positionToDate(dateAxis.toAxisPosition(pos));
            if (d && !Number.isNaN(d.getTime())) onPick(d.toISOString());
          });
        }

        chart.legend = new am4charts.Legend();
        chart.legend.position = "top";
        chart.legend.fontSize = 11;
        chart.legend.labels.template.fill = muted;
        return chart;
      }}
    />
  );
}
