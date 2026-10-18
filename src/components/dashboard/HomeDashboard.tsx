"use client";

import Link from "next/link";
import { AlertTriangle, Brain, CalendarClock, CheckCircle2, FolderKanban, ListTodo, Package, Plus, Users } from "lucide-react";
import type { DashboardDto } from "@/lib/dashboard";
import type { MindMapSummary } from "@/lib/mindmaps";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { ProgressBarsChart } from "@/components/charts/ProgressBarsChart";
import { GlobalSearch } from "@/components/GlobalSearch";
import { DesktopAppPromo } from "@/components/DesktopAppPromo";
import { IosInstallHint } from "@/components/IosInstallHint";
import { StalePanel } from "./StalePanel";
import { ResurfacePanel } from "./ResurfacePanel";
import {
  Badge,
  DELIVERABLE_STATUS_COLOR,
  DELIVERABLE_STATUS_LABEL,
  PriorityFlag,
  ProgressBar,
  TASK_STATUS_COLOR,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  TASK_STATUSES,
  formatDate,
  isFinished,
  relativeDays,
} from "@/components/ui";

/**
 * Tableau de bord personnel : indicateurs, mes tâches, échéances à venir,
 * répartitions (amCharts 4) et avancement par projet.
 */
export function HomeDashboard({ data, maps, userName }: { data: DashboardDto; maps: MindMapSummary[]; userName: string }) {
  const openMine = data.myTasks.filter((t) => !isFinished(t.status));
  const openCount = data.myOpenCount;
  const next7 = data.next7Count;
  const activeProjects = data.projects.filter((p) => p.status === "ACTIVE");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Bonjour {userName} 👋</h1>
      <p className="mt-1 text-sm text-muted">Votre journée en un coup d&apos;œil.</p>

      {/* Recherche globale avec auto-complétion */}
      <GlobalSearch className="mt-5" />

      {/* Invitation « Télécharger l'app » (site, Windows, masquable) */}
      <DesktopAppPromo className="mt-4" />
      {/* iPhone : ajouter à l'écran d'accueil (PWA) */}
      <IosInstallHint className="mt-4" />

      {/* Indicateurs */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<ListTodo className="h-5 w-5" />} label="Mes tâches ouvertes" value={openCount} hint={`${data.myStatusCounts.DONE + data.myStatusCounts.CLOSED} terminée${data.myStatusCounts.DONE + data.myStatusCounts.CLOSED > 1 ? "s" : ""}`} />
        <Kpi icon={<AlertTriangle className="h-5 w-5" />} label="En retard" value={data.overdueCount} tone={data.overdueCount > 0 ? "danger" : "ok"} hint="tâches et livrables" />
        <Kpi icon={<CalendarClock className="h-5 w-5" />} label="Échéances sous 7 jours" value={next7} tone={next7 > 0 ? "warn" : "neutral"} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5" />} label="Avancement global" value={`${data.globalProgress.percent}%`} hint={`${data.globalProgress.done}/${data.globalProgress.total} tâches · ${activeProjects.length} projet${activeProjects.length > 1 ? "s" : ""} actif${activeProjects.length > 1 ? "s" : ""}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Mes tâches */}
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <ListTodo className="h-5 w-5 text-brand-600" /> Mes tâches
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{openCount}</span>
          </h2>
          {openMine.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Aucune tâche ouverte : affectez-vous des tâches depuis un projet (onglet Plan), ou créez-en dans vos propres projets.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {openMine.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2 -mx-2 rounded-lg px-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.projectColor ?? "var(--color-brand-500)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <PriorityFlag priority={t.priority} /> <span className="truncate">{t.name}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {t.projectName}
                        {t.stageName ? ` · ${t.stageName}` : ""}
                      </div>
                    </div>
                    <div className="hidden w-28 sm:block">
                      <ProgressBar percent={t.progress} color={t.projectColor} className="h-1.5" />
                    </div>
                    <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                    {t.dueDate && (
                      <span className={`hidden shrink-0 text-xs md:inline ${new Date(t.dueDate) < new Date() ? "text-danger" : "text-muted"}`}>{formatDate(t.dueDate)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {openCount > 12 && <p className="mt-2 text-xs text-muted">… et {openCount - 12} autre{openCount - 12 > 1 ? "s" : ""}.</p>}
        </section>

        {/* Mes tâches par statut */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Mes tâches par statut</h2>
          <StatusDonut
            height={220}
            slices={TASK_STATUSES.map((s) => ({ label: TASK_STATUS_LABEL[s], value: data.myStatusCounts[s], color: TASK_STATUS_COLOR[s] }))}
          />
        </section>

        {/* Échéances */}
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="h-5 w-5 text-brand-600" /> Échéances à venir
            <span className="text-xs font-normal text-muted">(30 jours, tâches et livrables de tous mes projets)</span>
          </h2>
          {data.deadlines.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Rien d&apos;urgent : aucune échéance sous 30 jours.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.deadlines.slice(0, 15).map((d) => (
                <li key={`${d.kind}-${d.id}`}>
                  <Link
                    href={d.kind === "task" ? `/tasks/${d.id}` : `/projects/${d.projectId}#livrables`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2"
                  >
                    {d.kind === "task" ? <ListTodo className="h-4 w-4 shrink-0 text-muted" /> : <Package className="h-4 w-4 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {d.name}
                        {d.mine && <span className="ml-2 text-xs font-normal text-brand-600">moi</span>}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {d.projectName}
                        {d.assigneeName ? ` · ${d.assigneeName}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${d.daysLeft < 0 ? "text-danger" : d.daysLeft <= 3 ? "text-warn" : "text-muted"}`}>
                      {formatDate(d.dueDate)} · {relativeDays(d.daysLeft)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Livrables */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Livrables par statut</h2>
          <StatusDonut
            height={220}
            slices={(["PLANNED", "IN_PROGRESS", "DELIVERED", "VALIDATED"] as const).map((s) => ({
              label: DELIVERABLE_STATUS_LABEL[s],
              value: data.deliverableCounts[s],
              color: DELIVERABLE_STATUS_COLOR[s],
            }))}
          />
        </section>

        {/* Avancement par projet */}
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <FolderKanban className="h-5 w-5 text-brand-600" /> Avancement des projets
            </h2>
            <Link href="/projects" className="text-sm font-medium text-brand-600 hover:underline">
              Tout voir
            </Link>
          </div>
          {activeProjects.length === 0 ? (
            <Link href="/projects" className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-muted hover:bg-surface-2">
              <Plus className="h-4 w-4" /> Créer votre premier projet
            </Link>
          ) : (
            <ProgressBarsChart
              rows={activeProjects.map((p) => ({
                name: p.name,
                percent: p.progress.percent,
                color: p.color ?? "#4f5ff0",
                detail: `${p.progress.done}/${p.progress.total} tâches terminées`,
              }))}
            />
          )}
        </section>

        {/* Cartes mentales */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Brain className="h-5 w-5 text-brand-600" /> Cartes mentales
            </h2>
            <Link href="/mindmaps" className="text-sm font-medium text-brand-600 hover:underline">
              Tout voir
            </Link>
          </div>
          {maps.length === 0 ? (
            <Link href="/mindmaps" className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-muted hover:bg-surface-2">
              <Plus className="h-4 w-4" /> Créer votre première carte
            </Link>
          ) : (
            <ul className="divide-y divide-line">
              {maps.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link href={`/mindmaps/${m.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-brand-700">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.title}</span>
                      {m.owner && <Users className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-label={`Partagée par ${m.owner.name}`} />}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{m.nodeCount} nœud{m.nodeCount > 1 ? "s" : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <StalePanel />
        <ResurfacePanel />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone = "neutral" }: { icon: React.ReactNode; label: string; value: number | string; hint?: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const toneClass = { neutral: "bg-brand-50 text-brand-600", ok: "bg-green-50 text-green-700", warn: "bg-amber-50 text-amber-700", danger: "bg-red-50 text-red-700" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>{icon}</span>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-tight tabular-nums">{value}</div>
          <div className="truncate text-xs text-muted">{label}</div>
        </div>
      </div>
      {hint && <p className="mt-2 truncate text-xs text-faint">{hint}</p>}
    </div>
  );
}
