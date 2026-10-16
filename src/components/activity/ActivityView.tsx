"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, Brain, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, FileText, FolderKanban, Loader2, MessageSquare, Package, PencilLine, Plus, ShieldAlert, UsersRound } from "lucide-react";
import { api } from "@/lib/client";
import type { ActivityEvent, ActivityMap, ActivityProject, ActivityReport } from "@/lib/activity";
import { ACTIVITY_PRESETS, type ActivityPreset } from "@/lib/shared/activity-period";
import { Badge, TASK_STATUS_LABEL, TASK_STATUS_TONE, Toggle, errorMessage, inputClass, selectClassXs } from "@/components/ui";
import { DailyActivityChart } from "@/components/charts/DailyActivityChart";

/**
 * « Activité » : tout ce qui a évolué sur une fenêtre de temps libre (jour,
 * semaine, mois, dates quelconques), consolidé par projet et par carte
 * mentale — tâches (piste d'audit), nœuds, réunions, risques, livrables,
 * documents. Même rapport que l'outil MCP `get_activity` (GET /api/v1/activity).
 */

type Filters = { mode: "preset" | "custom"; preset: ActivityPreset; from: string; to: string; projectId: string; mapId: string; all: boolean };

function queryOf(f: Filters): string {
  const p = new URLSearchParams();
  if (f.mode === "preset") p.set("period", f.preset);
  else {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.projectId) p.set("projectId", f.projectId);
  if (f.mapId) p.set("mapId", f.mapId);
  if (f.all) p.set("all", "1");
  return p.toString();
}

const time = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ActivityView({
  initial,
  projects,
  maps,
  isAdmin,
}: {
  initial: ActivityReport;
  projects: { id: string; name: string }[];
  maps: { id: string; title: string }[];
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<Filters>({ mode: "preset", preset: "7d", from: initial.from, to: initial.to, projectId: "", mapId: "", all: false });
  const [report, setReport] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (filters.mode === "custom" && (!filters.from || !filters.to)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ activity: ActivityReport }>(`/activity?${queryOf(filters)}`)
      .then((r) => !cancelled && setReport(r.activity))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const t = report.totals;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Activity className="h-6 w-6 text-brand-600" /> Activité
          </h1>
          <p className="mt-1 text-sm text-muted">
            Tout ce qui a évolué : tâches, cartes mentales, réunions, risques, livrables et documents — {report.label}
            {report.scope === "all" ? " — toute la plateforme" : ""}.
          </p>
        </div>
        {loading && <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted" aria-label="Chargement" />}
      </div>

      {/* Fenêtre de temps et filtres */}
      <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Période">
          {ACTIVITY_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={filters.mode === "preset" && filters.preset === p.key}
              onClick={() => set({ mode: "preset", preset: p.key })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filters.mode === "preset" && filters.preset === p.key ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={filters.mode === "custom"}
            onClick={() => set({ mode: "custom", from: report.from, to: report.to })}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${filters.mode === "custom" ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Dates libres
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          {filters.mode === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Du
                <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className={`${inputClass} py-1.5`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Au
                <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className={`${inputClass} py-1.5`} />
              </label>
            </>
          )}
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Projet
            <select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value, mapId: "" })} className={`${selectClassXs} max-w-[16rem]`} disabled={filters.all}>
              <option value="">Tous</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Carte mentale
            <select value={filters.mapId} onChange={(e) => set({ mapId: e.target.value, projectId: "" })} className={`${selectClassXs} max-w-[16rem]`} disabled={filters.all}>
              <option value="">Toutes</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          {isAdmin && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <Toggle checked={filters.all} onChange={(v) => set({ all: v, projectId: "", mapId: "" })} label="Toute la plateforme (administration)" />
              Toute la plateforme
            </label>
          )}
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
      </section>

      {/* Synthèse */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={<Plus className="h-5 w-5" />} label="Tâches créées" value={t.tasksCreated} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5" />} label="Terminées / clôturées" value={t.tasksCompleted + t.tasksClosed} hint={t.tasksReopened ? `${t.tasksReopened} rouverte${t.tasksReopened > 1 ? "s" : ""}` : undefined} />
        <Kpi icon={<CalendarDays className="h-5 w-5" />} label="Replanifications" value={t.tasksRescheduled} hint={`${t.assignments} affectation${t.assignments > 1 ? "s" : ""}`} />
        <Kpi icon={<MessageSquare className="h-5 w-5" />} label="Commentaires" value={t.comments} />
        <Kpi icon={<Brain className="h-5 w-5" />} label="Nœuds créés / modifiés" value={`${t.nodesCreated} / ${t.nodesChanged}`} hint={`${t.notesEdited} séance${t.notesEdited > 1 ? "s" : ""} de notes${t.nodesDeleted ? `, ${t.nodesDeleted} supprimé${t.nodesDeleted > 1 ? "s" : ""}` : ""}`} />
        <Kpi icon={<UsersRound className="h-5 w-5" />} label="Réunions" value={t.meetings} hint={`${t.decisions} décision${t.decisions > 1 ? "s" : ""} sur compte-rendu`} />
        <Kpi icon={<ShieldAlert className="h-5 w-5" />} label="Risques / opportunités" value={t.risks} />
        <Kpi icon={<Package className="h-5 w-5" />} label="Livrables / documents" value={`${t.deliverables} / ${t.documents}`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Activité par jour</h2>
          <DailyActivityChart days={report.days} />
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Personnes actives</h2>
          {report.people.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Personne sur cette période.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {report.people.slice(0, 12).map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {report.truncated && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Très forte activité : certains détails sont résumés (les entrées les plus récentes de chaque élément sont affichées).</p>}

      {report.projects.length === 0 && report.maps.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-muted">Rien n&apos;a bougé sur cette période.</p>
      )}

      {report.projects.length > 0 && (
        <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
          <FolderKanban className="h-5 w-5 text-brand-600" /> Projets <span className="text-sm font-normal text-muted">({report.projects.length})</span>
        </h2>
      )}
      <div className="mt-3 space-y-3">
        {report.projects.map((p) => (
          <ProjectCard key={p.id ?? "none"} p={p} defaultOpen={report.projects.length <= 3} />
        ))}
      </div>

      {report.maps.length > 0 && (
        <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
          <Brain className="h-5 w-5 text-brand-600" /> Cartes mentales <span className="text-sm font-normal text-muted">({report.maps.length})</span>
        </h2>
      )}
      <div className="mt-3 space-y-3">
        {report.maps.map((m) => (
          <MapCard key={m.id} m={m} defaultOpen={report.maps.length <= 3} />
        ))}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <div className="min-w-0">
          <div className="text-xl font-semibold leading-tight tabular-nums">{value}</div>
          <div className="truncate text-xs text-muted">{label}</div>
          {hint && <div className="truncate text-[11px] text-faint">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function Chips({ items }: { items: [string, number][] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items
        .filter(([, n]) => n > 0)
        .map(([label, n]) => (
          <span key={label} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
            {label} <b className="tabular-nums">{n}</b>
          </span>
        ))}
    </div>
  );
}

function Events({ events, max = 3 }: { events: ActivityEvent[]; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? [...events].reverse() : [...events].reverse().slice(0, max);
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((e, i) => (
        <li key={i} className="flex gap-2 text-xs text-ink-2">
          <time className="w-28 shrink-0 text-faint" dateTime={e.at}>
            {time(e.at)}
          </time>
          <span className="min-w-0 break-words">{e.message}</span>
        </li>
      ))}
      {events.length > max && (
        <li>
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[11px] font-medium text-brand-700 hover:underline">
            {all ? "Réduire" : `Voir les ${events.length} modifications`}
          </button>
        </li>
      )}
    </ul>
  );
}

function Card({ title, color, href, chips, total, defaultOpen, children, badge }: { title: string; color: string | null; href: string | null; chips: [string, number][]; total: number; defaultOpen: boolean; children: React.ReactNode; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-2 p-4">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-2" aria-label={open ? "Replier" : "Déplier"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "var(--color-line-strong)" }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {href ? (
              <Link href={href} className="truncate font-semibold hover:underline">
                {title}
              </Link>
            ) : (
              <span className="truncate font-semibold">{title}</span>
            )}
            {badge}
            <span className="text-xs text-muted">
              {total} évolution{total > 1 ? "s" : ""}
            </span>
          </div>
          <div className="mt-1.5">
            <Chips items={chips} />
          </div>
        </div>
      </div>
      {open && <div className="space-y-4 border-t border-line px-4 py-3">{children}</div>}
    </section>
  );
}

function ProjectCard({ p, defaultOpen }: { p: ActivityProject; defaultOpen: boolean }) {
  const c = p.counts;
  const [showAll, setShowAll] = useState(false);
  const tasks = useMemo(() => (showAll ? p.tasks : p.tasks.slice(0, 15)), [p.tasks, showAll]);
  return (
    <Card
      title={p.name}
      color={p.color}
      href={p.id ? `/projects/${p.id}` : "/projects/sans-projet"}
      total={p.total}
      defaultOpen={defaultOpen}
      badge={p.createdInPeriod ? <Badge tone="ok">Nouveau projet</Badge> : null}
      chips={[
        ["créées", c.tasksCreated],
        ["terminées", c.tasksCompleted],
        ["clôturées", c.tasksClosed],
        ["rouvertes", c.tasksReopened],
        ["replanifiées", c.tasksRescheduled],
        ["affectations", c.assignments],
        ["commentaires", c.comments],
        ["autres modifications", c.taskChanges],
        ["réunions", c.meetings],
        ["risques", c.risks],
        ["livrables", c.deliverables],
        ["documents", c.documents],
      ]}
    >
      {p.stagesCreated.length > 0 && <p className="text-sm text-ink-2">Étapes créées : {p.stagesCreated.join(", ")}</p>}
      {p.tasks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Tâches ({p.tasks.length})</h3>
          <ul className="mt-1 divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {t.deleted ? <span className="font-medium text-muted line-through">{t.name}</span> : <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.name}</Link>}
                  {!t.deleted && <Badge tone={TASK_STATUS_TONE[t.status as keyof typeof TASK_STATUS_TONE] ?? "neutral"}>{TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}</Badge>}
                  {t.stageName && <span className="text-xs text-muted">{t.stageName}</span>}
                </div>
                <Events events={t.events} />
              </li>
            ))}
          </ul>
          {p.tasks.length > 15 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
              {showAll ? "Réduire" : `Voir les ${p.tasks.length} tâches`}
            </button>
          )}
        </div>
      )}
      {p.meetings.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <UsersRound className="h-3.5 w-3.5" /> Réunions
          </h3>
          <ul className="mt-1 space-y-2">
            {p.meetings.map((m) => (
              <li key={m.id}>
                <Link href={`/projects/${p.id}?meeting=${m.id}#reunions`} className="text-sm font-medium hover:underline">
                  {m.title}
                </Link>{" "}
                <span className="text-xs text-muted">{new Date(m.date).toLocaleDateString("fr-FR")}</span>
                <Events events={m.events} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.risks.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-3.5 w-3.5" /> Risques et opportunités
          </h3>
          <ul className="mt-1 space-y-1 text-sm">
            {p.risks.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span>{r.kind === "OPPORTUNITY" ? "Opportunité" : "Risque"} « {r.title} »</span>
                <Badge tone={r.created ? "ok" : "neutral"}>{r.created ? "créé" : "modifié"}</Badge>
                <span className="text-xs text-muted">
                  {r.level} · {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(p.deliverables.length > 0 || p.documents.length > 0) && (
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <FileText className="h-3.5 w-3.5" /> Livrables et documents
          </h3>
          <ul className="mt-1 space-y-1 text-sm">
            {p.deliverables.map((d) => (
              <li key={d.id}>
                Livrable « {d.name} » <span className="text-xs text-muted">({d.created ? "créé" : "modifié"})</span>
              </li>
            ))}
            {p.documents.map((d) => (
              <li key={d.id}>
                Document « {d.name} » <span className="text-xs text-muted">ajouté{d.actor ? ` par ${d.actor}` : ""} — {time(d.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function MapCard({ m, defaultOpen }: { m: ActivityMap; defaultOpen: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const nodes = showAll ? m.nodes : m.nodes.slice(0, 15);
  return (
    <Card
      title={m.title}
      color="#8b5cf6"
      href={`/mindmaps/${m.id}`}
      total={m.total}
      defaultOpen={defaultOpen}
      chips={[
        ["nœuds créés", m.counts.nodesCreated],
        ["modifiés", m.counts.nodesChanged],
        ["supprimés", m.counts.nodesDeleted],
        ["séances de notes", m.counts.notesEdited],
      ]}
    >
      {m.events.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Carte</h3>
          <Events events={m.events} />
        </div>
      )}
      {m.nodes.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Nœuds ({m.nodes.length})</h3>
          <ul className="mt-1 divide-y divide-line">
            {nodes.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex items-center gap-2 text-sm">
                  <PencilLine className="h-3.5 w-3.5 shrink-0 text-faint" />
                  {n.deleted ? <span className="font-medium text-muted line-through">{n.title}</span> : <Link href={`/mindmaps/${m.id}?node=${n.id}`} className="font-medium hover:underline">{n.title}</Link>}
                </div>
                <Events events={n.events} />
              </li>
            ))}
          </ul>
          {m.nodes.length > 15 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
              {showAll ? "Réduire" : `Voir les ${m.nodes.length} nœuds`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
