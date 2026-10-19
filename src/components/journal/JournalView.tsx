"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  BookHeart,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Frown,
  Lightbulb,
  LineChart,
  Loader2,
  Repeat,
  Settings2,
  Smile,
  Sparkles,
  Trophy,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/client";
import { parisYmd } from "@/lib/shared/activity-period";
import {
  JOURNAL_BLOCK_HINT,
  JOURNAL_BLOCK_LABEL,
  formatJournalDay,
  shiftDay,
  type JournalActivityItem,
  type JournalBlockKey,
  type JournalDayDto,
  type JournalWrittenBlock,
} from "@/lib/shared/journal";
import { RichTextEditor } from "@/components/RichTextEditor";
import { errorMessage, toast } from "@/components/ui";
import { JournalCalendar } from "./JournalCalendar";
import { JournalReportDialog } from "./JournalReportDialog";

/**
 * Journal quotidien : la date du jour en tête (flèches jour précédent /
 * suivant, calendrier avec pastilles des jours renseignés, « Aujourd'hui »),
 * puis les blocs activés dans les préférences — sept blocs en texte riche
 * enregistrés automatiquement, et « Activité », rempli depuis les pistes
 * d'audit. Chaque bloc ouvre son rapport d'évolution entre deux dates.
 * Données : /api/v1/journal/** (en ligne, application comprise).
 */

export const JOURNAL_ICONS: Record<JournalBlockKey, { icon: LucideIcon; color: string }> = {
  SUMMARY: { icon: BookHeart, color: "#4f5ff0" },
  POSITIVE: { icon: Smile, color: "#1f9d55" },
  NEGATIVE: { icon: Frown, color: "#d13b3b" },
  ACHIEVEMENTS: { icon: Trophy, color: "#d98a0b" },
  REGRETS: { icon: Undo2, color: "#8b5cf6" },
  HABITS: { icon: Repeat, color: "#0ea5e9" },
  IMPROVEMENT: { icon: Lightbulb, color: "#ec4899" },
  ACTIVITY: { icon: Activity, color: "#64748b" },
};

const SAVE_DELAY = 800;

export function JournalView({ initial }: { initial: JournalDayDto }) {
  const today = useMemo(() => parisYmd(), []);
  const [data, setData] = useState<JournalDayDto>(initial);
  const [day, setDay] = useState(initial.day);
  const [loading, setLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [report, setReport] = useState<JournalBlockKey | null>(null);
  const flushers = useRef(new Set<() => Promise<void>>());

  const go = useCallback(
    async (next: string) => {
      if (next > today || next === day) return;
      // Enregistre ce qui est en attente avant de quitter la journée.
      await Promise.all([...flushers.current].map((f) => f()));
      setDay(next);
      setCalendarOpen(false);
      setLoading(true);
      try {
        const r = await api.get<{ journal: JournalDayDto }>(`/journal/days/${next}`);
        setData(r.journal);
      } catch (e) {
        toast(errorMessage(e, "Journal indisponible hors connexion."), "error");
      } finally {
        setLoading(false);
      }
    },
    [day, today],
  );

  // Raccourcis clavier : Alt+← / Alt+→.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      void go(shiftDay(day, e.key === "ArrowLeft" ? -1 : 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [day, go]);

  const entries = new Map(data.entries.map((e) => [e.block, e]));
  const blocks = data.blocks;
  const isToday = day === today;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Journal quotidien</h1>
        <Link href="/preferences#journal" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
          <Settings2 className="h-3.5 w-3.5" /> Personnaliser les blocs
        </Link>
      </div>

      {/* Date et navigation */}
      <div className="sticky top-14 z-20 mt-4 rounded-2xl border border-line bg-surface/95 px-2 py-2 shadow-sm backdrop-blur sm:px-3 md:top-2">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => void go(shiftDay(day, -1))} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Jour précédent" title="Jour précédent (Alt+←)">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-base font-semibold first-letter:uppercase sm:text-lg">{formatJournalDay(day)}</p>
            <p className="text-xs text-muted">{isToday ? "Aujourd'hui" : relative(day, today)}</p>
          </div>
          <button
            type="button"
            onClick={() => void go(shiftDay(day, 1))}
            disabled={isToday}
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 disabled:opacity-30"
            aria-label="Jour suivant"
            title="Jour suivant (Alt+→)"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setCalendarOpen((o) => !o)}
              className={`rounded-lg p-2 hover:bg-surface-2 ${calendarOpen ? "bg-surface-2 text-brand-700" : "text-ink-2"}`}
              aria-label="Choisir un jour"
              aria-expanded={calendarOpen}
              title="Choisir un jour"
            >
              <CalendarDays className="h-5 w-5" />
            </button>
            {calendarOpen && <JournalCalendar selected={day} today={today} onPick={(d) => void go(d)} onClose={() => setCalendarOpen(false)} />}
          </div>
          {!isToday && (
            <button type="button" onClick={() => void go(today)} className="hidden rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 sm:block">
              Aujourd&apos;hui
            </button>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-muted">
          Tous les blocs sont désactivés.{" "}
          <Link href="/preferences#journal" className="font-medium text-brand-600 hover:underline">
            Choisir les blocs à afficher
          </Link>
        </p>
      ) : (
        <div className={`mt-4 space-y-4 ${loading ? "pointer-events-none opacity-60" : ""}`}>
          {blocks.map((b) =>
            b === "ACTIVITY" ? (
              <ActivityBlock key={`${day}:${b}`} items={data.activity} onReport={() => setReport(b)} />
            ) : (
              <WrittenBlock key={`${day}:${b}`} day={day} block={b} initialHtml={entries.get(b)?.content ?? ""} updatedAt={entries.get(b)?.updatedAt ?? null} flushers={flushers.current} onReport={() => setReport(b)} />
            ),
          )}
        </div>
      )}

      {report && <JournalReportDialog block={report} today={today} onClose={() => setReport(null)} onOpenDay={(d) => (setReport(null), void go(d))} />}
    </div>
  );
}

function relative(day: string, today: string): string {
  const n = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000);
  if (n === 1) return "Hier";
  if (n === 2) return "Avant-hier";
  if (n < 0) return "À venir";
  return `Il y a ${n} jours`;
}

function BlockHeader({ block, onReport, children }: { block: JournalBlockKey; onReport: () => void; children?: React.ReactNode }) {
  const { icon: Icon, color } = JOURNAL_ICONS[block];
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1a`, color }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold leading-tight">{JOURNAL_BLOCK_LABEL[block]}</h2>
        <p className="text-xs text-muted">{JOURNAL_BLOCK_HINT[block]}</p>
      </div>
      {children}
      <button
        type="button"
        onClick={onReport}
        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-brand-700"
        title={`Évolution « ${JOURNAL_BLOCK_LABEL[block]} »`}
        aria-label={`Rapport d'évolution : ${JOURNAL_BLOCK_LABEL[block]}`}
      >
        <LineChart className="h-4 w-4" />
      </button>
    </div>
  );
}

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** Bloc rédigé : éditeur riche, enregistrement automatique (anti-rebond) et à la sortie. */
function WrittenBlock({
  day,
  block,
  initialHtml,
  updatedAt,
  flushers,
  onReport,
}: {
  day: string;
  block: JournalWrittenBlock;
  initialHtml: string;
  updatedAt: string | null;
  flushers: Set<() => Promise<void>>;
  onReport: () => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState(updatedAt);
  const draft = useRef<string | null>(null);
  const last = useRef(initialHtml);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const html = draft.current;
    if (html === null || html === last.current) return;
    draft.current = null;
    setState("saving");
    try {
      const r = await api.put<{ entry: { updatedAt: string } | null }>(`/journal/days/${day}/blocks/${block}`, { content: html });
      last.current = html;
      setSavedAt(r.entry?.updatedAt ?? null);
      setState("saved");
    } catch (e) {
      draft.current = html;
      setState("error");
      toast(errorMessage(e, "Enregistrement impossible."), "error");
    }
  }, [day, block]);

  useEffect(() => {
    flushers.add(flush);
    return () => {
      flushers.delete(flush);
      void flush();
    };
  }, [flush, flushers]);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  return (
    <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <BlockHeader block={block} onReport={onReport}>
        <span className="mt-1 shrink-0 text-[11px] text-muted" aria-live="polite">
          {state === "saving" || state === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Enregistrement…" />
          ) : state === "error" ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <CloudOff className="h-3.5 w-3.5" /> Non enregistré
            </span>
          ) : state === "saved" || savedAt ? (
            <span className="inline-flex items-center gap-1" title={savedAt ? `Enregistré le ${new Date(savedAt).toLocaleString("fr-FR")}` : undefined}>
              <Check className="h-3.5 w-3.5 text-ok" /> Enregistré
            </span>
          ) : null}
        </span>
      </BlockHeader>
      <div className="mt-3">
        <RichTextEditor
          initialHtml={initialHtml}
          documentKey={`${day}:${block}`}
          variant="compact"
          minHeight={96}
          placeholder="Écrivez ici… (enregistrement automatique)"
          onChange={(html) => {
            draft.current = html;
            setState("pending");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), SAVE_DELAY);
          }}
        />
      </div>
    </section>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** Regroupe les actions par objet (tâche, carte), dans l'ordre de la dernière action. */
export function groupActivity(items: JournalActivityItem[]) {
  const groups = new Map<string, { kind: JournalActivityItem["kind"]; id: string; name: string; context: string | null; items: JournalActivityItem[] }>();
  for (const it of items) {
    const key = `${it.kind}:${it.objectId}`;
    const g = groups.get(key) ?? { kind: it.kind, id: it.objectId, name: it.objectName, context: it.context, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function ActivityList({ items, max = 8 }: { items: JournalActivityItem[]; max?: number }) {
  const groups = groupActivity(items);
  return (
    <ul className="divide-y divide-line">
      {groups.map((g) => (
        <li key={`${g.kind}:${g.id}`} className="py-2">
          <Link href={g.kind === "map" ? `/mindmaps/${g.id}` : `/tasks/${g.id}`} className="flex min-w-0 items-baseline gap-2 hover:text-brand-700">
            <span className="truncate text-sm font-medium">{g.name}</span>
            {g.context && <span className="shrink-0 truncate text-xs text-muted">{g.context}</span>}
            <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">{g.items.length}</span>
          </Link>
          <ul className="mt-1 space-y-0.5">
            {g.items.slice(0, max).map((it, i) => (
              <li key={i} className="flex gap-2 text-xs text-ink-2">
                <span className="w-10 shrink-0 tabular-nums text-muted">{hhmm(it.at)}</span>
                <span className="min-w-0">{it.message}</span>
              </li>
            ))}
            {g.items.length > max && <li className="pl-12 text-xs text-muted">… et {g.items.length - max} autre{g.items.length - max > 1 ? "s" : ""}</li>}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Bloc « Activité » : actions du jour d'après les pistes d'audit (tâches, cartes). */
function ActivityBlock({ items, onReport }: { items: JournalActivityItem[]; onReport: () => void }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <BlockHeader block="ACTIVITY" onReport={onReport}>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
          <Sparkles className="h-3.5 w-3.5" /> Automatique
        </span>
      </BlockHeader>
      <div className="mt-2">
        {items.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">Aucune action enregistrée ce jour-là.</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              {items.length} action{items.length > 1 ? "s" : ""} sur {groupActivity(items).length} élément{groupActivity(items).length > 1 ? "s" : ""}
            </p>
            <ActivityList items={items} />
          </>
        )}
      </div>
    </section>
  );
}
