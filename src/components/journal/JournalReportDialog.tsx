"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/client";
import { JOURNAL_BLOCK_LABEL, formatJournalDay, shiftDay, type JournalBlockKey, type JournalReportDto } from "@/lib/shared/journal";
import { JournalTrendChart } from "@/components/charts/JournalTrendChart";
import { errorMessage, inputClass } from "@/components/ui";
import { ActivityList, JOURNAL_ICONS } from "./JournalView";

/**
 * Rapport d'évolution d'un bloc du journal entre deux dates (par défaut les
 * 30 derniers jours) : courbe quotidienne (mots saisis, ou actions pour
 * « Activité ») et toutes les saisies de la période, la plus récente
 * d'abord ; un clic sur une date ouvre cette journée. Fenêtre modale, tiroir
 * bas sur mobile.
 */
export function JournalReportDialog({ block, today, onClose, onOpenDay }: { block: JournalBlockKey; today: string; onClose: () => void; onOpenDay: (day: string) => void }) {
  const [from, setFrom] = useState(shiftDay(today, -30));
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<JournalReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { icon: Icon, color } = JOURNAL_ICONS[block];

  useEffect(() => {
    if (!from || !to || from > to) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<{ report: JournalReportDto }>(`/journal/report?block=${block}&from=${from}&to=${to}`)
      .then((r) => alive && setReport(r.report))
      .catch((e) => alive && setError(errorMessage(e, "Rapport indisponible hors connexion.")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [block, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isActivity = block === "ACTIVITY";
  const filledDays = report ? (isActivity ? report.activityDays.length : report.entries.length) : 0;
  const total = report?.series.reduce((a, d) => a + d.value, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="journal-report-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1a`, color }}>
            <Icon className="h-4 w-4" />
          </span>
          <h2 id="journal-report-title" className="min-w-0 flex-1 truncate text-lg font-semibold">
            {JOURNAL_BLOCK_LABEL[block]} : évolution
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Du
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputClass} w-40 py-1.5`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Au
              <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputClass} w-40 py-1.5`} />
            </label>
            {[7, 30, 90].map((n) => (
              <button key={n} type="button" onClick={() => (setFrom(shiftDay(today, -n)), setTo(today))} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2">
                {n} j
              </button>
            ))}
            {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted" />}
          </div>

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

          {report && (
            <>
              <p className="mt-3 text-sm text-ink-2">
                {isActivity
                  ? `${total} action${total > 1 ? "s" : ""} sur ${filledDays} jour${filledDays > 1 ? "s" : ""} actif${filledDays > 1 ? "s" : ""}.`
                  : `${filledDays} jour${filledDays > 1 ? "s" : ""} renseigné${filledDays > 1 ? "s" : ""} · ${total} mot${total > 1 ? "s" : ""}.`}
              </p>
              <div className="mt-2">
                <JournalTrendChart series={report.series} unit={isActivity ? "actions" : "mots"} color={color} onPick={onOpenDay} />
              </div>

              <ul className="mt-3 space-y-3">
                {isActivity
                  ? report.activityDays.map((d) => (
                      <li key={d.day} className="rounded-xl border border-line p-3">
                        <DayLink day={d.day} onOpenDay={onOpenDay} extra={`${d.count} action${d.count > 1 ? "s" : ""}`} />
                        <ActivityList items={d.items} max={4} />
                      </li>
                    ))
                  : report.entries.map((e) => (
                      <li key={e.day} className="rounded-xl border border-line p-3">
                        <DayLink day={e.day} onOpenDay={onOpenDay} />
                        {/* Contenu assaini par le serveur (sanitizeNotes) à l'enregistrement et à la lecture. */}
                        <div className="prose prose-sm mt-1 max-w-none text-ink-2" dangerouslySetInnerHTML={{ __html: e.content }} />
                      </li>
                    ))}
              </ul>
              {filledDays === 0 && <p className="mt-3 text-center text-sm text-muted">Rien sur cette période.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DayLink({ day, onOpenDay, extra }: { day: string; onOpenDay: (day: string) => void; extra?: string }) {
  return (
    <button type="button" onClick={() => onOpenDay(day)} className="flex w-full items-baseline gap-2 text-left text-sm font-semibold first-letter:uppercase hover:text-brand-700">
      <span className="first-letter:uppercase">{formatJournalDay(day)}</span>
      {extra && <span className="text-xs font-normal text-muted">{extra}</span>}
    </button>
  );
}
