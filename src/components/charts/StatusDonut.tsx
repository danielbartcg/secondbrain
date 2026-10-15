"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

export type DonutSlice = { label: string; value: number; color: string };

/** Anneau de répartition (tâches ou livrables par statut) — amCharts 4 PieChart. */
export function StatusDonut({ slices, height = 240, centerLabel }: { slices: DonutSlice[]; height?: number; centerLabel?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const data = slices.filter((s) => s.value > 0);
  return (
    <AmChart
      height={height}
      deps={[JSON.stringify(data), centerLabel]}
      empty={total === 0 ? "Aucune donnée" : null}
      build={(am4core, am4charts, container) => {
        const chart = am4core.create(container, am4charts.PieChart);
        applyBaseTheme(am4core, chart);
        chart.data = data;
        chart.innerRadius = am4core.percent(58);
        chart.radius = am4core.percent(90);
        chart.paddingTop = 4;
        chart.paddingBottom = 4;

        const series = chart.series.push(new am4charts.PieSeries());
        series.dataFields.value = "value";
        series.dataFields.category = "label";
        series.slices.template.propertyFields.fill = "color";
        series.slices.template.stroke = am4core.color(themeColor("--color-surface", "#ffffff"));
        series.slices.template.strokeWidth = 2;
        series.slices.template.tooltipText = "{category} : [bold]{value}[/] ({value.percent.formatNumber('#.')} %)";
        series.labels.template.disabled = true;
        series.ticks.template.disabled = true;
        series.hiddenState.properties.opacity = 1;
        series.hiddenState.properties.endAngle = -90;
        series.hiddenState.properties.startAngle = -90;

        const label = series.createChild(am4core.Label);
        label.text = centerLabel ?? String(total);
        label.horizontalCenter = "middle";
        label.verticalCenter = "middle";
        label.fontSize = 20;
        label.fontWeight = "600";
        label.fill = am4core.color(themeColor("--color-ink", "#17171a"));

        chart.legend = new am4charts.Legend();
        // Légende à droite, ou dessous quand le conteneur est étroit (mobile).
        const legend = chart.legend;
        const placeLegend = (width: number) => {
          const position = width < 400 ? "bottom" : "right";
          if (legend.position !== position) legend.position = position;
        };
        placeLegend(container.clientWidth);
        chart.events.on("sizechanged", () => placeLegend(chart.pixelWidth));
        chart.legend.fontSize = 12;
        chart.legend.labels.template.fill = am4core.color(themeColor("--color-ink-2", "#3b3b40"));
        chart.legend.valueLabels.template.fill = am4core.color(themeColor("--color-muted", "#6d6c72"));
        chart.legend.valueLabels.template.text = "{value}";
        chart.legend.itemContainers.template.paddingTop = 2;
        chart.legend.itemContainers.template.paddingBottom = 2;
        chart.legend.markers.template.width = 12;
        chart.legend.markers.template.height = 12;
        chart.legend.useDefaultMarker = true;
        return chart;
      }}
    />
  );
}
