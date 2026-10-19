"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/client";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Calendrier du journal (fenêtre flottante) : mois par mois, jours renseignés
 * marqués d'une pastille, jours futurs désactivés. Échap ou clic extérieur
 * ferme.
 */
export function JournalCalendar({ selected, today, onPick, onClose }: { selected: string; today: string; onPick: (day: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lundi = 0
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  useEffect(() => {
    let alive = true;
    api
      .get<{ days: string[] }>(`/journal/calendar?from=${month}-01&to=${month}-${pad(daysInMonth)}`)
      .then((r) => alive && setFilled(new Set(r.days)))
      .catch(() => alive && setFilled(new Set()));
    return () => {
      alive = false;
    };
  }, [month, daysInMonth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[aria-label='Choisir un jour']") && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (string | null)[] = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`)];

  return (
    <div ref={ref} role="dialog" aria-label="Calendrier du journal" className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-line bg-surface p-3 shadow-xl">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Mois précédent">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold first-letter:uppercase">{title}</span>
        <button type="button" onClick={() => shift(1)} disabled={`${month}-01` > today} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Mois suivant">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1 text-[11px] font-medium text-muted">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              disabled={d > today}
              onClick={() => onPick(d)}
              aria-current={d === selected ? "date" : undefined}
              aria-label={`${Number(d.slice(8))}${filled.has(d) ? " (renseigné)" : ""}`}
              className={`relative flex h-8 items-center justify-center rounded-lg text-sm tabular-nums transition disabled:opacity-30 ${
                d === selected ? "bg-brand-600 font-semibold text-on-brand" : d === today ? "font-semibold text-brand-700 ring-1 ring-brand-500" : "hover:bg-surface-2"
              }`}
            >
              {Number(d.slice(8))}
              {filled.has(d) && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${d === selected ? "bg-on-brand" : "bg-brand-600"}`} aria-hidden />}
            </button>
          ),
        )}
      </div>
      <button type="button" onClick={() => onPick(today)} className="mt-2 w-full rounded-lg border border-line py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2">
        Aujourd&apos;hui
      </button>
    </div>
  );
}
