"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

export type ProgressRow = { name: string; percent: number; color: string; detail?: string };

/** Barres horizontales d'avancement (par projet ou par étape) — amCharts 4 XYChart. */
export function ProgressBarsChart({ rows, height }: { rows: ProgressRow[]; height?: number }) {
  const h = height ?? Math.max(160, 40 + rows.length * 38);
  return (
    <AmChart
      height={h}
      deps={[JSON.stringify(rows)]}
      empty={rows.length === 0 ? "Aucune donnée" : null}
      build={(am4core, am4charts, container) => {
        const chart = am4core.create(container, am4charts.XYChart);
        applyBaseTheme(am4core, chart);
        // `[` ouvre une balise de style amCharts : on le double dans le texte utilisateur.
        chart.data = rows.map((r) => ({ ...r, name: r.name.replace(/\[/g, "[[").replace(/\]/g, "]]"), detail: r.detail?.replace(/\[/g, "[[").replace(/\]/g, "]]"), rest: 100 - r.percent }));
        chart.paddingRight = 24;
        chart.paddingLeft = 0;

        const ink2 = am4core.color(themeColor("--color-ink-2", "#3b3b40"));
        const muted = am4core.color(themeColor("--color-muted", "#6d6c72"));
        const line = am4core.color(themeColor("--color-line", "#e3e1db"));
        const track = am4core.color(themeColor("--color-surface-3", "#e9e7e1"));

        const catAxis = chart.yAxes.push(new am4charts.CategoryAxis());
        catAxis.dataFields.category = "name";
        catAxis.renderer.inversed = true;
        catAxis.renderer.grid.template.disabled = true;
        catAxis.renderer.minGridDistance = 10;
        catAxis.renderer.labels.template.fill = ink2;
        catAxis.renderer.labels.template.fontSize = 12;
        catAxis.renderer.labels.template.truncate = true;
        catAxis.renderer.labels.template.maxWidth = 160;
        catAxis.renderer.labels.template.tooltipText = "{category}";

        const valAxis = chart.xAxes.push(new am4charts.ValueAxis());
        valAxis.min = 0;
        valAxis.max = 100;
        valAxis.strictMinMax = true;
        valAxis.extraMax = 0;
        valAxis.renderer.minLabelPosition = 0;
        valAxis.renderer.maxLabelPosition = 1;
        valAxis.renderer.labels.template.fill = muted;
        valAxis.renderer.labels.template.fontSize = 11;
        valAxis.renderer.labels.template.adapter.add("text", (text) => (text ? `${text} %` : text));
        valAxis.renderer.grid.template.stroke = line;
        valAxis.renderer.grid.template.strokeOpacity = 1;
        valAxis.renderer.minGridDistance = 60;

        // Fond de jauge (reste à faire)
        const rest = chart.series.push(new am4charts.ColumnSeries());
        rest.dataFields.valueX = "rest";
        rest.dataFields.categoryY = "name";
        rest.stacked = true;
        rest.columns.template.fill = track;
        rest.columns.template.strokeOpacity = 0;
        rest.columns.template.height = am4core.percent(55);
        rest.columns.template.column.cornerRadius(6, 6, 6, 6);
        rest.zIndex = 0;

        const done = chart.series.push(new am4charts.ColumnSeries());
        done.dataFields.valueX = "percent";
        done.dataFields.categoryY = "name";
        done.stacked = true;
        done.columns.template.propertyFields.fill = "color";
        done.columns.template.strokeOpacity = 0;
        done.columns.template.height = am4core.percent(55);
        done.columns.template.column.cornerRadius(6, 6, 6, 6);
        done.columns.template.tooltipText = "{categoryY} : [bold]{valueX} %[/]\n{detail}";
        done.zIndex = 1;
        // La série « done » doit être dessinée en premier dans l'empilement : on inverse l'ordre.
        chart.series.moveValue(done, 0);

        const bullet = done.bullets.push(new am4charts.LabelBullet());
        bullet.label.text = "{valueX} %";
        bullet.label.fill = ink2;
        bullet.label.fontSize = 11;
        bullet.label.horizontalCenter = "left";
        bullet.label.dx = 4;
        bullet.locationX = 0;
        bullet.label.truncate = false;
        bullet.label.hideOversized = false;
        return chart;
      }}
    />
  );
}
