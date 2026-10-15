"use client";

import { AmChart, applyBaseTheme, themeColor } from "./AmChart";

/**
 * Diagramme de Gantt des tâches d'un projet (amCharts 4, XYChart) :
 *  - une barre par tâche planifiée (début → échéance incluse), couleur de son
 *    étape, avancement en pourcentage dans la barre ;
 *  - flèches de dépendance (prérequis → tâche), en rouge si le prérequis finit
 *    après le début de la tâche ;
 *  - échelle jour / semaine / mois, barre de défilement horizontale ;
 *  - barres **glissables** horizontalement : `onMove(taskId, jours)` au lâcher
 *    (décalage arrondi au jour) ; double-clic : `onOpen(taskId)`.
 */

export type GanttTask = {
  id: string;
  name: string;
  group: string;
  color: string;
  start: string; // AAAA-MM-JJ
  end: string; // AAAA-MM-JJ (inclus)
  percent: number;
  done: boolean;
  prerequisiteIds: string[];
  conflict: boolean;
};

export type GanttScale = "day" | "week" | "month";

const DAY = 86_400_000;
const escapeAm = (s: string) => s.replace(/\[/g, "[[").replace(/\]/g, "]]");
const parseDay = (s: string) => new Date(`${s}T00:00:00`);

/**
 * Échelle : marge autour des tâches, durée minimale de l'axe (pour que
 * l'échelle reste lisible) et largeur maximale affichée d'un coup (au-delà,
 * on fait défiler).
 */
const SCALE = {
  day: { pad: 2, minSpan: 21, maxVisible: 35 },
  week: { pad: 7, minSpan: 8 * 7, maxVisible: 26 * 7 },
  month: { pad: 15, minSpan: 6 * 31, maxVisible: 24 * 31 },
} as const;

/** Bornes de l'axe et fenêtre visible initiale (centrée sur aujourd'hui si possible). */
function bounds(scale: GanttScale, first: number, last: number): { min: number; max: number; from: number; to: number } {
  const cfg = SCALE[scale];
  let min = first - cfg.pad * DAY;
  let max = last + cfg.pad * DAY;
  if (max - min < cfg.minSpan * DAY) {
    const extra = cfg.minSpan * DAY - (max - min);
    min -= extra / 3;
    max += (extra * 2) / 3;
  }
  const visible = cfg.maxVisible * DAY;
  if (max - min <= visible) return { min, max, from: min, to: max };
  const today = new Date().setHours(0, 0, 0, 0);
  let from = today > min && today < max ? today - visible * 0.15 : min;
  from = Math.max(min, Math.min(from, max - visible));
  return { min, max, from, to: from + visible };
}

export function GanttChart({
  tasks,
  scale,
  onMove,
  onOpen,
  readOnly = false,
}: {
  tasks: GanttTask[];
  scale: GanttScale;
  onMove: (taskId: string, deltaDays: number) => void;
  onOpen: (taskId: string) => void;
  readOnly?: boolean;
}) {
  const height = Math.max(200, 90 + tasks.length * 34);

  return (
    <AmChart
      height={height}
      deps={[JSON.stringify(tasks), scale, readOnly]}
      empty={tasks.length === 0 ? "Donnez une date de début ou d'échéance aux tâches pour les voir dans le Gantt." : null}
      build={(am4core, am4charts, container) => {
        const chart = am4core.create(container, am4charts.XYChart);
        applyBaseTheme(am4core, chart);
        chart.paddingRight = 16;
        chart.paddingLeft = 0;

        const names = new Map(tasks.map((t) => [t.id, t]));
        const rows = tasks.map((t) => {
          const start = parseDay(t.start);
          const end = new Date(parseDay(t.end).getTime() + DAY); // échéance incluse
          return {
            id: t.id,
            start,
            end,
            color: am4core.color(t.color),
            stroke: am4core.color(t.conflict ? themeColor("--color-danger", "#d13b3b") : t.color),
            fillOpacity: t.done ? 0.45 : 0.85,
            label: t.percent > 0 ? `${t.percent} %` : "",
            tooltip: `[bold]${escapeAm(t.name)}[/]\n${escapeAm(t.group)}\n${start.toLocaleDateString("fr-FR")} → ${parseDay(t.end).toLocaleDateString("fr-FR")}\nAvancement : ${t.percent} %${t.conflict ? "\n[#d13b3b]⚠ un prérequis finit après le début[/]" : ""}`,
          };
        });
        chart.data = rows;

        const ink2 = am4core.color(themeColor("--color-ink-2", "#3b3b40"));
        const muted = am4core.color(themeColor("--color-muted", "#6d6c72"));
        const line = am4core.color(themeColor("--color-line", "#e3e1db"));
        const danger = am4core.color(themeColor("--color-danger", "#d13b3b"));
        const surface = am4core.color(themeColor("--color-surface", "#ffffff"));

        // Axe des tâches (une ligne par tâche, libellé = nom)
        const catAxis = chart.yAxes.push(new am4charts.CategoryAxis());
        catAxis.dataFields.category = "id";
        catAxis.renderer.inversed = true;
        catAxis.renderer.grid.template.location = 0;
        catAxis.renderer.grid.template.stroke = line;
        catAxis.renderer.minGridDistance = 10;
        // Le curseur afficherait l'identifiant technique de la tâche : pas d'infobulle sur cet axe.
        catAxis.cursorTooltipEnabled = false;
        catAxis.renderer.cellStartLocation = 0.15;
        catAxis.renderer.cellEndLocation = 0.85;
        const labels = catAxis.renderer.labels.template;
        labels.fill = ink2;
        labels.fontSize = 12;
        labels.truncate = true;
        labels.maxWidth = 180;
        labels.adapter.add("text", (_text, target) => {
          const t = names.get((target.dataItem as { category?: string } | undefined)?.category ?? "");
          return t ? escapeAm(t.name) : "";
        });
        labels.cursorOverStyle = am4core.MouseCursorStyle.pointer;
        labels.events.on("hit", (ev) => {
          const id = (ev.target.dataItem as { category?: string } | undefined)?.category;
          if (id) onOpen(id);
        });

        // Axe des dates
        const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
        dateAxis.baseInterval = { count: 1, timeUnit: "day" };
        dateAxis.renderer.labels.template.fill = muted;
        dateAxis.renderer.labels.template.fontSize = 11;
        dateAxis.renderer.grid.template.stroke = line;
        dateAxis.renderer.opposite = true; // échelle en haut, comme un Gantt classique
        dateAxis.tooltipDateFormat = "EEE dd MMM yyyy";
        if (scale === "day") {
          dateAxis.gridIntervals.setAll([
            { timeUnit: "day", count: 1 },
            { timeUnit: "day", count: 2 },
            { timeUnit: "week", count: 1 },
          ]);
          dateAxis.renderer.minGridDistance = 28;
        } else if (scale === "week") {
          dateAxis.gridIntervals.setAll([
            { timeUnit: "week", count: 1 },
            { timeUnit: "week", count: 2 },
            { timeUnit: "month", count: 1 },
          ]);
          dateAxis.renderer.minGridDistance = 55;
        } else {
          dateAxis.gridIntervals.setAll([
            { timeUnit: "month", count: 1 },
            { timeUnit: "month", count: 2 },
            { timeUnit: "month", count: 3 },
          ]);
          dateAxis.renderer.minGridDistance = 45;
        }
        dateAxis.dateFormats.setKey("day", "dd");
        dateAxis.periodChangeDateFormats.setKey("day", "dd MMM");
        dateAxis.dateFormats.setKey("week", "dd MMM");
        dateAxis.periodChangeDateFormats.setKey("week", "dd MMM yyyy");
        dateAxis.dateFormats.setKey("month", "MMM");
        dateAxis.periodChangeDateFormats.setKey("month", "MMM yyyy");
        void import("@amcharts/amcharts4/lang/fr_FR").then((mod) => {
          if (!chart.isDisposed()) chart.language.locale = mod.default;
        });

        // Bornes : toutes les tâches + marge, et au moins la fenêtre de l'échelle.
        const { min, max, from, to } = bounds(scale, Math.min(...rows.map((r) => r.start.getTime())), Math.max(...rows.map((r) => r.end.getTime())));
        dateAxis.min = min;
        dateAxis.max = max;
        dateAxis.strictMinMax = true;
        dateAxis.keepSelection = true;
        chart.events.on("datavalidated", () => dateAxis.zoomToDates(new Date(from), new Date(to), false, true));

        // Week-ends grisés en vue jour
        if (scale === "day") {
          for (let d = new Date(dateAxis.min); d.getTime() < (dateAxis.max as number); d = new Date(d.getTime() + DAY)) {
            if (d.getDay() === 6) {
              const range = dateAxis.axisRanges.create();
              range.date = d;
              range.endDate = new Date(d.getTime() + 2 * DAY);
              range.axisFill.fill = line;
              range.axisFill.fillOpacity = 0.45;
              range.grid.disabled = true;
              range.label.disabled = true;
            }
          }
        }

        const byId = new Map(rows.map((r) => [r.id, r]));

        // Barres des tâches
        const series = chart.series.push(new am4charts.ColumnSeries());
        series.dataFields.openDateX = "start";
        series.dataFields.dateX = "end";
        series.dataFields.categoryY = "id";
        const col = series.columns.template;
        col.propertyFields.fill = "color";
        col.propertyFields.stroke = "stroke";
        col.propertyFields.fillOpacity = "fillOpacity";
        col.strokeWidth = 2;
        col.height = am4core.percent(100);
        col.column.cornerRadius(5, 5, 5, 5);
        col.tooltipText = "{tooltip}";
        const pct = series.bullets.push(new am4charts.LabelBullet());
        pct.label.text = "{label}";
        pct.label.fontSize = 10;
        pct.label.fill = surface;
        pct.locationX = 0.5;
        pct.label.truncate = true;
        pct.label.hideOversized = true;

        if (!readOnly) {
          col.draggable = true;
          col.cursorOverStyle = am4core.MouseCursorStyle.horizontalResize;
          let originX = 0;
          let originY = 0;
          col.events.on("dragstart", (ev) => {
            originX = ev.target.pixelX;
            originY = ev.target.pixelY;
            ev.target.tooltip?.hide(0);
          });
          // Déplacement horizontal uniquement.
          col.events.on("drag", (ev) => {
            ev.target.y = originY;
          });
          col.events.on("dragstop", (ev) => {
            const id = (ev.target.dataItem as { categoryY?: string } | undefined)?.categoryY;
            const dx = ev.target.pixelX - originX;
            ev.target.y = originY;
            if (!id || Math.abs(dx) < 3) {
              ev.target.x = originX;
              return;
            }
            // Échelle déduite de la barre elle-même (pixels par jour), quel que soit le zoom.
            const row = byId.get(id);
            const width = ev.target.pixelWidth;
            if (!row || width <= 0) return;
            const pxPerDay = width / ((row.end.getTime() - row.start.getTime()) / DAY);
            const days = Math.round(dx / pxPerDay);
            if (days === 0) {
              ev.target.x = originX;
              return;
            }
            onMove(id, days);
          });
        }
        col.events.on("doublehit", (ev) => {
          const id = (ev.target.dataItem as { categoryY?: string } | undefined)?.categoryY;
          if (id) onOpen(id);
        });

        // Flèches de dépendance : du bord droit du prérequis au bord gauche de la tâche.
        for (const t of tasks) {
          for (const pid of t.prerequisiteIds) {
            const p = byId.get(pid);
            const me = byId.get(t.id);
            if (!p || !me) continue;
            // Conflit : l'échéance (incluse) du prérequis est postérieure au début de la tâche.
            const late = p.end.getTime() - DAY > me.start.getTime();
            const link = chart.series.push(new am4charts.LineSeries());
            link.data = [
              { date: p.end, cat: p.id, arrow: false },
              { date: me.start, cat: me.id, arrow: true },
            ];
            link.dataFields.dateX = "date";
            link.dataFields.categoryY = "cat";
            link.stroke = late ? danger : muted;
            link.strokeWidth = 1.5;
            link.strokeDasharray = late ? "4,3" : "";
            link.tooltipText = "";
            link.interactionsEnabled = false;
            const arrow = link.bullets.push(new am4charts.Bullet());
            const tri = arrow.createChild(am4core.Triangle);
            tri.width = 8;
            tri.height = 8;
            tri.rotation = 90;
            tri.horizontalCenter = "right";
            tri.verticalCenter = "middle";
            tri.fill = late ? danger : muted;
            tri.stroke = late ? danger : muted;
            arrow.propertyFields.disabled = "noArrow";
            link.data = link.data.map((d) => ({ ...d, noArrow: !d.arrow }));
          }
        }

        // Ligne « aujourd'hui »
        const today = dateAxis.axisRanges.create();
        today.date = new Date(new Date().setHours(0, 0, 0, 0));
        today.grid.stroke = danger;
        today.grid.strokeWidth = 2;
        today.grid.strokeOpacity = 0.85;
        today.grid.strokeDasharray = "4,3";
        today.label.text = "Aujourd'hui";
        today.label.fill = danger;
        today.label.fontSize = 10;
        today.label.inside = true;
        today.label.valign = "bottom";
        today.label.horizontalCenter = "left";
        today.label.dx = 3;

        chart.scrollbarX = new am4core.Scrollbar();
        chart.scrollbarX.parent = chart.bottomAxesContainer;
        chart.scrollbarX.minHeight = 8;
        chart.zoomOutButton.disabled = true;
        chart.mouseWheelBehavior = "panX";
        chart.cursor = new am4charts.XYCursor();
        chart.cursor.behavior = "none";
        chart.cursor.lineY.disabled = true;
        return chart;
      }}
    />
  );
}
