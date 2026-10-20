"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Glisser-déposer au pointeur (souris, stylet, doigt) pour réordonner des
 * cartes — plus fiable que le glisser-déposer HTML5 (inopérant au doigt,
 * capricieux sur les cartes riches). On saisit la **poignée** (`handle(id)`) ;
 * l'élément visé est trouvé sous le pointeur :
 *   - `[data-reorder-item="<id>"]` (du même `group`) → avant / après lui
 *     (moitié gauche / droite en grille, haut / bas en colonne) ;
 *   - sinon `[data-reorder-zone="<id>"]` → dans la zone (fin de liste).
 * Une étiquette suit le pointeur ; Échap annule.
 */

export type ReorderTarget = { kind: "item"; id: string; position: "before" | "after"; vertical?: boolean } | { kind: "zone"; id: string };
type Drag = { id: string; label: string; x: number; y: number; startX: number; startY: number; moved: boolean; pointerId: number };

const THRESHOLD = 4;

export function usePointerReorder(group: string, onDrop: (id: string, target: ReorderTarget) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<ReorderTarget | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const dragRef = useRef<Drag | null>(null);
  const targetRef = useRef<ReorderTarget | null>(null);

  const locate = useCallback(
    (x: number, y: number, selfId: string): ReorderTarget | null => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const item = el.closest<HTMLElement>(`[data-reorder-group="${group}"][data-reorder-item]`);
      if (item) {
        const id = item.dataset.reorderItem!;
        if (id === selfId) return null;
        const r = item.getBoundingClientRect();
        const parent = item.parentElement?.getBoundingClientRect();
        const singleColumn = !parent || r.width > parent.width * 0.7;
        const before = singleColumn ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
        return { kind: "item", id, position: before ? "before" : "after", vertical: singleColumn };
      }
      const zone = el.closest<HTMLElement>(`[data-reorder-group="${group}"][data-reorder-zone]`);
      return zone ? { kind: "zone", id: zone.dataset.reorderZone! } : null;
    },
    [group],
  );

  const finish = useCallback((commit: boolean) => {
    const d = dragRef.current;
    const t = targetRef.current;
    dragRef.current = null;
    targetRef.current = null;
    setDrag(null);
    setTarget(null);
    if (commit && d?.moved && t) dropRef.current(d.id, t);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drag, finish]);

  /** Propriétés de la poignée d'un élément. */
  const handle = (id: string, label: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const d = { id, label, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
      dragRef.current = d;
      setDrag(d);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const moved = d.moved || Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > THRESHOLD;
      const next = { ...d, x: e.clientX, y: e.clientY, moved };
      dragRef.current = next;
      setDrag(next);
      if (!moved) return;
      const t = locate(e.clientX, e.clientY, d.id);
      targetRef.current = t;
      setTarget(t);
      // Défilement automatique près des bords de la fenêtre.
      const edge = 60;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    style: { touchAction: "none" as const },
  });

  /** Classes d'un élément : déplacé (estompé), visé (repère avant / après). */
  const itemClass = (id: string) => {
    if (!drag?.moved) return "";
    if (drag.id === id) return "opacity-40";
    if (target?.kind === "item" && target.id === id) return `${target.position === "before" ? "reorder-before" : "reorder-after"}${target.vertical ? " reorder-y" : ""}`;
    return "";
  };
  const zoneActive = (id: string) => !!drag?.moved && target?.kind === "zone" && target.id === id;

  const ghost =
    drag?.moved && typeof document !== "undefined"
      ? createPortal(
          <div className="pointer-events-none fixed z-[90] max-w-[16rem] truncate rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-on-brand shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.label}
          </div>,
          document.body,
        )
      : null;

  return { handle, itemClass, zoneActive, dragging: drag?.moved ? drag.id : null, ghost };
}
