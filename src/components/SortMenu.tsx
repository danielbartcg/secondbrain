"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpDown, Clock } from "lucide-react";

/**
 * Bouton « Trier » des listes de projets et de cartes : A → Z ou par date de
 * mise à jour (la plus récente d'abord). Le tri devient l'ordre personnel
 * (listes et épingles du menu), ajustable ensuite par glisser-déposer.
 */
export function SortMenu({ onSort }: { onSort: (by: "alpha" | "updated") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (by: "alpha" | "updated") => {
    setOpen(false);
    onSort(by);
  };
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-3"
        title="Trier (puis glissez-déposez pour ajuster)"
      >
        <ArrowUpDown className="h-3.5 w-3.5" /> Trier
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          <button type="button" role="menuitem" onClick={() => pick("alpha")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
            <ArrowDownAZ className="h-4 w-4 text-muted" /> Par ordre alphabétique
          </button>
          <button type="button" role="menuitem" onClick={() => pick("updated")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
            <Clock className="h-4 w-4 text-muted" /> Par date de mise à jour
          </button>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Glissez-déposez ensuite pour ajuster ; le menu suit cet ordre.</p>
        </div>
      )}
    </div>
  );
}
