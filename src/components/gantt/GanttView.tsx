"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, LocateFixed } from "lucide-react";
import { PALETTE } from "@/components/charts/AmChart";
import { TASK_STATUS_LABEL, isFinished } from "@/components/ui";
import { GanttConnectors } from "./GanttConnectors";
import {
  ROW_H,
  SCALE_PX,
  buildLinks,
  buildRows,
  conflictIds,
  duration,
  fmtRange,
  fmtShort,
  fmtSlip,
  headerTiers,
  isWeekend,
  planUpdates,
  previewSpans,
  slipDays,
  snapDays,
  stageSpan,
  taskSpan,
  timelineRange,
  todayNum,
  unionSpan,
  weekends,
  type DateUpdate,
  type DragMode,
  type GProject,
  type GTask,
  type GanttRow,
  type GanttScale,
  type Span,
} from "./ganttModel";

/**
 * Diagramme de Gantt dédié (React + HTML/CSS + SVG pour les liens) :
 *  - grille à gauche (collante au défilement horizontal) : Nom hiérarchique
 *    étape › activité › tâche repliable, Début, Fin, Durée, % ;
 *  - frise à droite : en-tête à deux niveaux, week-ends, ligne « aujourd'hui »,
 *    barres de tâches (couleur de l'étape, avancement, conflit), barres de
 *    synthèse des étapes / activités, liens fin → début ;
 *  - barres manipulables à la souris et au doigt (Pointer Events) : milieu =
 *    déplacer, bords = changer le début ou la fin, au jour près, avec aperçu
 *    en direct (cascade sur les dépendantes comprise) ; clavier : ← → déplacer,
 *    Maj+← → fin, Ctrl+← → début, Entrée ouvrir.
 *
 * Les dates envoyées sont confiées à `onCommit` ; un brouillon local garde les
 * barres en place pendant l'enregistrement.
 */

export type GanttCommit = { updates: DateUpdate[]; taskId: string; mode: DragMode; delta: number };

type Props = {
  project: GProject;
  scale: GanttScale;
  cascade: boolean;
  busy?: boolean;
  onCommit: (c: GanttCommit) => Promise<void>;
  onOpen: (taskId: string) => void;
  /** Planning de référence : étendues figées par clé de ligne (barres fantômes, glissements). */
  baseline?: Map<string, Span> | null;
};

const LEFT_W = "w-[170px] md:w-[400px]";
const HEAD_UP = 22;
const HEAD_LOW = 30;
/** Au-delà de ce nombre de lignes, le diagramme est virtualisé. */
const VIRTUAL_MIN = 150;
const OVERSCAN = 25;
const BAR_H = 20;
const BAR_TOP = (ROW_H - BAR_H) / 2;
const DRAG_THRESHOLD = 4;

type Drag = { id: string; mode: DragMode; startX: number; pointerId: number; moved: boolean; delta: number; raf: number };

export function GanttView({ project, scale, cascade, busy = false, onCommit, onOpen, baseline = null }: Props) {
  const px = SCALE_PX[scale];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Map<string, Span>>(() => new Map());
  const [preview, setPreview] = useState<Map<string, Span> | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const today = useMemo(() => todayNum(), []);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);
  const open = useCallback((id: string) => openRef.current(id), []);

  // Toutes les tâches du projet (pour la cascade sur les dépendantes).
  const allTasks = useMemo<GTask[]>(
    () => [...project.stages.flatMap((s) => [...s.activities.flatMap((a) => a.tasks), ...s.tasks]), ...project.tasks],
    [project],
  );

  const baseSpan = useCallback((t: GTask) => drafts.get(t.id) ?? taskSpan(t), [drafts]);
  const liveSpan = useCallback((t: GTask) => preview?.get(t.id) ?? drafts.get(t.id) ?? taskSpan(t), [preview, drafts]);

  const { rows, planned, groupKeys } = useMemo(() => buildRows(project, collapsed, PALETTE, liveSpan), [project, collapsed, liveSpan]);

  // Bornes de la frise : calculées hors aperçu pour ne pas bouger pendant le glisser.
  const baseSpans = useMemo(
    () => [...allTasks.map(baseSpan), ...project.stages.map((s) => stageSpan(s, [])), ...(baseline ? [...baseline.values()] : [])],
    [allTasks, baseSpan, project.stages, baseline],
  );
  const range = useMemo(() => timelineRange(baseSpans, today, scale), [baseSpans, today, scale]);
  const width = (range.end - range.start + 1) * px;
  const height = Math.max(rows.length, 1) * ROW_H;

  // Virtualisation verticale (gros projets) : seules les lignes visibles, plus
  // une marge, sont rendues ; les lignes ont une hauteur fixe (ROW_H).
  const [view, setView] = useState({ top: 0, h: 800 });
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setView((v) => (v.top === sc.scrollTop && v.h === sc.clientHeight ? v : { top: sc.scrollTop, h: sc.clientHeight })));
    };
    update();
    sc.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      sc.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const virtual = rows.length > VIRTUAL_MIN;
  const from = virtual ? Math.max(0, Math.floor((view.top - HEAD_UP - HEAD_LOW) / ROW_H) - OVERSCAN) : 0;
  const to = virtual ? Math.min(rows.length, Math.ceil((view.top + view.h) / ROW_H) + OVERSCAN) : rows.length;
  const inView = (i: number) => i >= from && i < to;
  const xOf = useCallback((d: number) => (d - range.start) * px, [range.start, px]);

  const tasks = useMemo(() => planned.map((p) => p.task), [planned]);
  const liveSpans = useMemo(() => new Map(planned.map((p) => [p.task.id, liveSpan(p.task)!])), [planned, liveSpan]);
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => r.kind === "task" && m.set(r.key, i));
    return m;
  }, [rows]);
  const conflicts = useMemo(() => conflictIds(tasks, liveSpans), [tasks, liveSpans]);
  const links = useMemo(() => buildLinks(tasks, liveSpans, rowIndex, xOf), [tasks, liveSpans, rowIndex, xOf]);
  const tiers = useMemo(() => headerTiers(range, scale), [range, scale]);
  const weekendSpans = useMemo(() => (scale === "month" ? [] : weekends(range)), [range, scale]);

  const groupName = useMemo(() => {
    const m = new Map<string, string>([["group:none", "Sans étape"]]);
    for (const s of project.stages) {
      m.set(`stage:${s.id}`, s.name);
      for (const a of s.activities) m.set(`activity:${a.id}`, a.name);
    }
    return m;
  }, [project.stages]);
  const parentsOf = useMemo(() => new Map(planned.map((p) => [p.task.id, p.parents])), [planned]);

  // ---- Défilement initial : aujourd'hui, ou la première tâche si le plan est loin d'aujourd'hui.
  const focusDay = useMemo(() => {
    const u = unionSpan(allTasks.map(taskSpan));
    if (!u || (today >= u.start - 14 && today <= u.end + 14)) return today;
    return u.start;
  }, [allTasks, today]);
  const scrollToDay = useCallback(
    (n: number, smooth = false) => {
      const sc = scrollerRef.current;
      if (!sc) return false;
      const view = sc.clientWidth - (leftRef.current?.offsetWidth ?? 0);
      sc.scrollTo({ left: Math.max(0, xOf(n) - view * 0.25), behavior: smooth ? "smooth" : "auto" });
      return true;
    },
    [xOf],
  );
  const scrolledFor = useRef<string>("");
  useLayoutEffect(() => {
    if (scrolledFor.current === scale) return;
    if (scrollToDay(focusDay)) scrolledFor.current = scale;
  }, [scale, focusDay, scrollToDay]);

  useEffect(() => () => cancelAnimationFrame(dragRef.current?.raf ?? 0), []);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ---- Enregistrement (brouillon optimiste pendant la requête)
  async function commit(id: string, mode: DragMode, delta: number) {
    const updates = planUpdates(allTasks, id, mode, delta, cascade);
    if (!updates.length) return;
    const spans = previewSpans(updates);
    setDrafts((prev) => {
      const m = new Map(prev);
      spans.forEach((s, k) => m.set(k, s));
      return m;
    });
    try {
      await onCommit({ updates, taskId: id, mode, delta });
    } finally {
      setDrafts((prev) => {
        const m = new Map(prev);
        for (const k of spans.keys()) m.delete(k);
        return m;
      });
    }
  }

  // ---- Pointer Events (souris, stylet, doigt), délégués sur la couche des barres
  const barOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-task]") : null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const bar = barOf(e.target);
    if (!bar) {
      setSelected(null);
      return;
    }
    if (busy || e.button !== 0 || dragRef.current) return;
    const mode = ((e.target as Element).closest("[data-mode]")?.getAttribute("data-mode") ?? "move") as DragMode;
    bar.setPointerCapture(e.pointerId);
    dragRef.current = { id: bar.dataset.task!, mode, startX: e.clientX, pointerId: e.pointerId, moved: false, delta: 0, raf: 0 };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragId(d.id);
      setHover(d.id);
    }
    const delta = snapDays(dx, px);
    if (delta === d.delta) return;
    d.delta = delta;
    cancelAnimationFrame(d.raf);
    d.raf = requestAnimationFrame(() => setPreview(previewSpans(planUpdates(allTasks, d.id, d.mode, d.delta, cascade))));
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    cancelAnimationFrame(d.raf);
    setPreview(null);
    setDragId(null);
    if (!d.moved) {
      if (!cancelled) setSelected(d.id);
      return;
    }
    setSelected(d.id);
    if (!cancelled && d.delta !== 0) void commit(d.id, d.mode, d.delta);
  }

  function onPointerOver(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.moved) return;
    setHover(barOf(e.target)?.dataset.task ?? null);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const bar = barOf(e.target);
    if (!bar) return;
    const id = bar.dataset.task!;
    if (e.key === "Enter") {
      e.preventDefault();
      open(id);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setSelected(id);
    if (busy) return;
    const mode: DragMode = e.shiftKey ? "end" : e.ctrlKey || e.metaKey ? "start" : "move";
    void commit(id, mode, e.key === "ArrowLeft" ? -1 : 1);
  }

  // ---- Infobulle
  const tipId = dragId ?? hover;
  const tipSpan = tipId ? liveSpans.get(tipId) : undefined;
  const tipRow = tipId ? rowIndex.get(tipId) : undefined;
  const tipTask = tipId && tipRow !== undefined ? (rows[tipRow] as Extract<GanttRow, { kind: "task" }>).task : null;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
        Donnez une date de début ou d&apos;échéance aux tâches pour les voir dans le Gantt.
      </p>
    );
  }

  const todayX = xOf(today);
  const boundaries = scale === "month" ? tiers.lower : tiers.upper;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ToolButton onClick={() => setCollapsed(new Set())} icon={<ChevronsUpDown className="h-3.5 w-3.5" />} label="Tout déplier" />
        <ToolButton onClick={() => setCollapsed(new Set(groupKeys))} icon={<ChevronsDownUp className="h-3.5 w-3.5" />} label="Tout replier" />
        <ToolButton onClick={() => scrollToDay(today, true)} icon={<LocateFixed className="h-3.5 w-3.5" />} label="Aujourd'hui" />
      </div>

      <div
        ref={scrollerRef}
        className="relative max-h-[70vh] overflow-auto overscroll-x-contain rounded-xl border border-line bg-surface"
        aria-busy={busy}
      >
        <div className="relative w-max min-w-full">
          {/* En-tête */}
          <div className="sticky top-0 z-30 flex border-b border-line-strong bg-surface">
            <div
              className={`${LEFT_W} sticky left-0 z-40 flex shrink-0 items-end border-r border-line-strong bg-surface text-[11px] font-medium uppercase tracking-wide text-muted`}
              style={{ height: HEAD_UP + HEAD_LOW }}
            >
              <div className="flex w-full items-center pb-1.5">
                <span className="min-w-0 flex-1 truncate pl-2">Nom</span>
                <span className="hidden w-16 shrink-0 md:block">Début</span>
                <span className="hidden w-16 shrink-0 md:block">Fin</span>
                <span className="hidden w-11 shrink-0 text-right md:block">Durée</span>
                <span className="w-11 shrink-0 pr-2 text-right">%</span>
              </div>
            </div>
            <div className="relative shrink-0" style={{ width, height: HEAD_UP + HEAD_LOW }}>
              {tiers.upper.map((c) => (
                <div
                  key={`u${c.start}`}
                  className="absolute top-0 overflow-hidden border-b border-l border-line px-1.5 text-[11px] font-semibold capitalize leading-[22px] whitespace-nowrap text-ink-2"
                  style={{ left: xOf(c.start), width: duration(c) * px, height: HEAD_UP }}
                  title={c.label}
                >
                  {c.label}
                </div>
              ))}
              {tiers.lower.map((c) => {
                const isToday = scale === "day" && c.start === today;
                const weekend = scale === "day" && isWeekend(c.start);
                return (
                  <div
                    key={`l${c.start}`}
                    title={c.title}
                    className={`absolute overflow-hidden border-l border-line text-center leading-none whitespace-nowrap ${weekend ? "bg-surface-2" : ""} ${isToday ? "font-bold text-danger" : "text-muted"}`}
                    style={{ left: xOf(c.start), top: HEAD_UP, width: duration(c) * px, height: HEAD_LOW }}
                  >
                    {scale === "day" ? (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5">
                        <span className="text-[9px] text-faint">{c.sub}</span>
                        <span className="text-[11px] tabular-nums">{c.label}</span>
                      </div>
                    ) : scale === "week" ? (
                      <div className="flex h-full items-center gap-1 px-1.5 text-[11px]">
                        <span className="font-semibold text-ink-2">{c.label}</span>
                        <span className="truncate">{c.sub}</span>
                      </div>
                    ) : (
                      <div className="flex h-full items-center px-1.5 text-[11px] capitalize">{c.label}</div>
                    )}
                  </div>
                );
              })}
              {today >= range.start && today <= range.end && (
                <div
                  className="pointer-events-none absolute bottom-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-danger"
                  style={{ left: todayX + px / 2 }}
                  aria-hidden
                />
              )}
            </div>
          </div>

          {/* Corps */}
          <div className="flex">
            <div ref={leftRef} className={`${LEFT_W} sticky left-0 z-20 shrink-0 border-r border-line-strong bg-surface`} style={virtual ? { height } : undefined}>
              {from > 0 && <div style={{ height: from * ROW_H }} aria-hidden />}
              {rows.slice(from, to).map((r) => {
                const span = r.span;
                return (
                  <GridRow
                    key={r.key}
                    rowKey={r.key}
                    kind={r.kind}
                    level={r.level}
                    name={r.name}
                    color={r.color}
                    start={span ? fmtShort(span.start) : "—"}
                    end={span ? fmtShort(span.end) : "—"}
                    days={span ? duration(span) : null}
                    percent={r.percent}
                    slip={baseline ? slipDays(span, baseline.get(r.key)) : null}
                    collapsed={r.kind !== "task" ? r.collapsed : false}
                    count={r.kind !== "task" ? r.count : 0}
                    done={r.kind === "task" && isFinished(r.task.status)}
                    conflict={r.kind === "task" && conflicts.has(r.key)}
                    selected={selected === r.key}
                    onToggle={toggle}
                    onOpen={open}
                  />
                );
              })}
            </div>

            <div
              className="relative shrink-0 select-none"
              style={{
                width,
                height,
                backgroundImage: [
                  `linear-gradient(to bottom, transparent ${ROW_H - 1}px, var(--color-line) ${ROW_H - 1}px)`,
                  scale === "month" ? "none" : `linear-gradient(to right, color-mix(in srgb, var(--color-line) 70%, transparent) 1px, transparent 1px)`,
                ].join(","),
                backgroundSize: `100% ${ROW_H}px, ${scale === "day" ? px : px * 7}px 100%`,
              }}
            >
              {/* Fonds : week-ends, lignes de groupe, sélection, limites de mois / années */}
              {weekendSpans.map((w) => (
                <div key={`w${w.start}`} className="absolute inset-y-0 bg-surface-2 opacity-70" style={{ left: xOf(w.start), width: duration(w) * px }} aria-hidden />
              ))}
              {rows.map((r, i) =>
                !inView(i) ? null : r.kind !== "task" ? (
                  <div key={`bg${r.key}`} className="absolute inset-x-0 bg-surface-2 opacity-60" style={{ top: i * ROW_H, height: ROW_H - 1 }} aria-hidden />
                ) : selected === r.key || hover === r.key ? (
                  <div key={`bg${r.key}`} className={`absolute inset-x-0 ${selected === r.key ? "bg-brand-50" : "bg-surface-2"}`} style={{ top: i * ROW_H, height: ROW_H - 1 }} aria-hidden />
                ) : null,
              )}
              {boundaries.map((c) => (
                <div key={`b${c.start}`} className="absolute inset-y-0 w-px bg-line-strong opacity-60" style={{ left: xOf(c.start) }} aria-hidden />
              ))}
              {today >= range.start && today <= range.end && (
                <>
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger opacity-70" style={{ left: todayX + px / 2 - 1, zIndex: 1 }} aria-hidden />
                  <span
                    className="pointer-events-none absolute bottom-1 rounded bg-danger/85 px-1 py-px text-[10px] font-medium text-white"
                    style={{ left: todayX + px / 2 + 3, zIndex: 0 }}
                  >
                    Aujourd&apos;hui
                  </span>
                </>
              )}

              {/* Planning de référence : barre fantôme sous chaque barre réelle */}
              {baseline &&
                rows.map((r, i) => {
                  const b = baseline.get(r.key);
                  if (!b || !inView(i)) return null;
                  return (
                    <div
                      key={`base${r.key}`}
                      className="pointer-events-none absolute rounded-[2px] border border-ink-2/50"
                      style={{
                        left: xOf(b.start),
                        top: i * ROW_H + ROW_H - 7,
                        width: duration(b) * px,
                        height: 4,
                        zIndex: 2,
                        backgroundImage: "repeating-linear-gradient(135deg, var(--color-muted) 0 2px, transparent 2px 4px)",
                      }}
                      title={`Référence : ${fmtRange(b)}`}
                      aria-hidden
                    />
                  );
                })}

              <GanttConnectors links={links} width={width} height={height} focusId={dragId ?? hover ?? selected} />

              {/* Barres */}
              <div
                className={`absolute inset-0 ${busy ? "cursor-progress" : ""}`}
                style={{ zIndex: 3 }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endDrag(e, false)}
                onPointerCancel={(e) => endDrag(e, true)}
                onLostPointerCapture={(e) => endDrag(e, false)}
                onPointerOver={onPointerOver}
                onPointerLeave={() => !dragRef.current?.moved && setHover(null)}
                onDoubleClick={(e) => {
                  const bar = barOf(e.target);
                  if (bar) open(bar.dataset.task!);
                }}
                onKeyDown={onKeyDown}
              >
                {rows.map((r, i) => {
                  if (!r.span || (!inView(i) && r.key !== dragId)) return null;
                  const left = xOf(r.span.start);
                  const w = duration(r.span) * px;
                  if (r.kind === "task") {
                    return (
                      <TaskBar
                        key={r.key}
                        id={r.key}
                        name={r.name}
                        ariaLabel={`${r.name} : ${fmtRange(r.span)}${conflicts.has(r.key) ? " — conflit de prérequis" : ""}`}
                        left={left}
                        top={i * ROW_H + BAR_TOP}
                        width={w}
                        color={r.color}
                        percent={r.percent}
                        done={isFinished(r.task.status)}
                        conflict={conflicts.has(r.key)}
                        selected={selected === r.key}
                        dragging={dragId === r.key}
                        busy={busy}
                      />
                    );
                  }
                  return <SummaryBar key={r.key} left={left} top={i * ROW_H} width={w} color={r.color} percent={r.percent} stage={r.kind !== "activity"} />;
                })}

                {tipTask && tipSpan && tipRow !== undefined && (
                  <Tooltip
                    task={tipTask}
                    span={tipSpan}
                    group={(parentsOf.get(tipTask.id) ?? []).map((k) => groupName.get(k) ?? "").filter(Boolean).join(" › ")}
                    conflict={conflicts.has(tipTask.id)}
                    base={baseline?.get(tipTask.id) ?? null}
                    left={Math.max(4, Math.min(xOf(tipSpan.start), width - 264))}
                    top={tipRow >= rows.length - 3 && rows.length > 4 ? undefined : (tipRow + 1) * ROW_H + 2}
                    bottom={tipRow >= rows.length - 3 && rows.length > 4 ? height - tipRow * ROW_H + 2 : undefined}
                    dragging={dragId === tipTask.id}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 md:py-1"
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ligne de la grille de gauche
// ---------------------------------------------------------------------------

const GridRow = memo(function GridRow(p: {
  rowKey: string;
  kind: GanttRow["kind"];
  level: number;
  name: string;
  color: string;
  start: string;
  end: string;
  days: number | null;
  percent: number;
  slip: number | null;
  collapsed: boolean;
  count: number;
  done: boolean;
  conflict: boolean;
  selected: boolean;
  onToggle: (key: string) => void;
  onOpen: (id: string) => void;
}) {
  const group = p.kind !== "task";
  return (
    <div
      className={`flex items-center border-b border-line text-xs ${group ? "bg-surface-2 font-semibold text-ink" : p.selected ? "bg-brand-50 text-ink" : "text-ink-2"}`}
      style={{ height: ROW_H }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 pr-1" style={{ paddingLeft: 4 + p.level * 14 }}>
        {group ? (
          <button
            type="button"
            onClick={() => p.onToggle(p.rowKey)}
            aria-expanded={!p.collapsed}
            aria-label={`${p.collapsed ? "Déplier" : "Replier"} ${p.name}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-surface-3"
          >
            {p.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        {group ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color, opacity: p.kind === "activity" ? 0.6 : 1 }} aria-hidden />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
        )}
        {group ? (
          <span className={`truncate ${p.kind === "activity" ? "font-medium text-ink-2" : ""}`} title={p.name}>
            {p.name}
            {p.collapsed && <span className="ml-1 font-normal text-muted">({p.count})</span>}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => p.onOpen(p.rowKey)}
            title={`Ouvrir « ${p.name} »`}
            className={`min-w-0 truncate text-left hover:text-brand-600 hover:underline ${p.done ? "text-muted line-through decoration-faint" : ""}`}
          >
            {p.name}
          </button>
        )}
        {p.conflict && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Conflit de prérequis" />}
        {p.slip !== null && p.slip !== 0 && (
          <span
            className={`ml-auto shrink-0 rounded px-1 text-[10px] font-semibold tabular-nums ${p.slip > 0 ? "bg-red-50 text-danger" : "bg-ok/10 text-ok"}`}
            title={`${p.slip > 0 ? "Retard" : "Avance"} de ${Math.abs(p.slip)} jour${Math.abs(p.slip) > 1 ? "s" : ""} sur la référence`}
          >
            {fmtSlip(p.slip)}
          </span>
        )}
      </div>
      <span className="hidden w-16 shrink-0 tabular-nums text-muted md:block">{p.start}</span>
      <span className="hidden w-16 shrink-0 tabular-nums text-muted md:block">{p.end}</span>
      <span className="hidden w-11 shrink-0 text-right tabular-nums text-muted md:block">{p.days ?? "—"}</span>
      <span className="w-11 shrink-0 pr-2 text-right tabular-nums">{p.percent}</span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Barres
// ---------------------------------------------------------------------------

const TaskBar = memo(function TaskBar(p: {
  id: string;
  name: string;
  ariaLabel: string;
  left: number;
  top: number;
  width: number;
  color: string;
  percent: number;
  done: boolean;
  conflict: boolean;
  selected: boolean;
  dragging: boolean;
  busy: boolean;
}) {
  const label = `${p.done ? "✓ " : ""}${p.name}`;
  const inside = p.width >= label.length * 6.2 + 18;
  const handle = Math.max(4, Math.min(9, p.width / 4));
  const ring = p.conflict ? "0 0 0 2px var(--color-danger)" : p.selected ? "0 0 0 2px var(--color-brand-500)" : undefined;
  return (
    <>
      <button
        type="button"
        data-task={p.id}
        aria-label={p.ariaLabel}
        aria-pressed={p.selected}
        className="group/bar absolute rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        style={{
          left: p.left,
          top: p.top,
          width: p.width,
          height: BAR_H,
          boxShadow: p.dragging ? `${ring ? ring + "," : ""}0 4px 12px rgb(0 0 0 / 0.25)` : ring,
          cursor: p.busy ? "progress" : p.dragging ? "grabbing" : "grab",
          touchAction: "pan-y",
          zIndex: p.dragging ? 5 : undefined,
        }}
      >
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[5px]" style={{ backgroundColor: p.color, opacity: p.done ? 0.5 : 1 }}>
          <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${Math.max(0, Math.min(100, p.percent))}%` }} />
        </span>
        {inside && (
          <span className="pointer-events-none relative block truncate px-2 text-left text-[11px] font-medium leading-5 text-white">{label}</span>
        )}
        <span
          data-mode="start"
          className="absolute top-0 flex h-full cursor-ew-resize items-center justify-center"
          style={{ left: -3, width: handle + 3 }}
          aria-hidden
        >
          <span className="h-3 w-[3px] rounded-full bg-white/80 opacity-0 shadow transition-opacity group-hover/bar:opacity-100" />
        </span>
        <span
          data-mode="end"
          className="absolute top-0 flex h-full cursor-ew-resize items-center justify-center"
          style={{ right: -3, width: handle + 3 }}
          aria-hidden
        >
          <span className="h-3 w-[3px] rounded-full bg-white/80 opacity-0 shadow transition-opacity group-hover/bar:opacity-100" />
        </span>
      </button>
      {!inside && (
        <span
          className="pointer-events-none absolute truncate text-[11px] leading-5 text-ink-2"
          style={{ left: p.left + p.width + 6, top: p.top, maxWidth: 280 }}
          aria-hidden
        >
          {label}
        </span>
      )}
    </>
  );
});

/** Barre de synthèse (étape, activité, « Sans étape ») : crochet classique. */
const SummaryBar = memo(function SummaryBar(p: { left: number; top: number; width: number; color: string; percent: number; stage: boolean }) {
  const ink = p.stage ? "var(--color-ink-2)" : "var(--color-muted)";
  const h = p.stage ? 6 : 4;
  return (
    <div className="pointer-events-none absolute" style={{ left: p.left, top: p.top + 11, width: p.width, height: 14 }} aria-hidden>
      <div className="absolute inset-x-0 top-0 overflow-hidden rounded-[1px]" style={{ height: h, backgroundColor: ink }}>
        <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, p.percent))}%`, backgroundColor: p.color }} />
      </div>
      <div className="absolute left-0 top-0" style={{ width: 7, height: h + 5, backgroundColor: ink, clipPath: "polygon(0 0, 100% 0, 0 100%)" }} />
      <div className="absolute right-0 top-0" style={{ width: 7, height: h + 5, backgroundColor: ink, clipPath: "polygon(0 0, 100% 0, 100% 100%)" }} />
      <span className="absolute top-[-4px] whitespace-nowrap text-[10px] font-medium text-muted" style={{ left: p.width + 8 }}>
        {p.percent} %
      </span>
    </div>
  );
});

function Tooltip(p: {
  task: GTask;
  span: Span;
  group: string;
  conflict: boolean;
  base: Span | null;
  left: number;
  top?: number;
  bottom?: number;
  dragging: boolean;
}) {
  const status = TASK_STATUS_LABEL[p.task.status as keyof typeof TASK_STATUS_LABEL] ?? p.task.status;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-64 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: p.left, top: p.top, bottom: p.bottom }}
    >
      <p className="truncate font-semibold text-ink">{p.task.name}</p>
      {p.group && <p className="truncate text-muted">{p.group}</p>}
      <p className={`mt-1 tabular-nums ${p.dragging ? "font-semibold text-brand-600" : "text-ink-2"}`}>{fmtRange(p.span)}</p>
      {!p.dragging && (
        <p className="text-muted">
          {status} · {p.task.progress} %
        </p>
      )}
      {p.base && (
        <p className="text-muted">
          Référence : {fmtRange(p.base)}
          {(() => {
            const d = slipDays(p.span, p.base);
            return d ? <span className={d > 0 ? " font-semibold text-danger" : " font-semibold text-ok"}> ({fmtSlip(d)})</span> : null;
          })()}
        </p>
      )}
      {p.conflict && (
        <p className="mt-1 flex items-center gap-1 text-danger">
          <AlertTriangle className="h-3 w-3" /> Un prérequis finit après le début
        </p>
      )}
    </div>
  );
}
