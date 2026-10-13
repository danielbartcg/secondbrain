"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ListTodo, Package } from "lucide-react";
import type { ProjectDto } from "@/lib/projects";
import { PlanningChart } from "@/components/charts/PlanningChart";
import { ProgressBarsChart } from "@/components/charts/ProgressBarsChart";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { Avatar, Badge, DELIVERABLE_STATUS_COLOR, DELIVERABLE_STATUS_LABEL, DELIVERABLE_STATUS_TONE, TASK_STATUS_COLOR, TASK_STATUS_LABEL, TASK_STATUSES, formatDate, isFinished } from "@/components/ui";

/** Tableau de bord d'un projet : indicateurs, planning, avancement par étape, livrables. */
export function ProjectDashboardTab({ project, onGoTo }: { project: ProjectDto; onGoTo: (tab: "plan" | "livrables" | "documents" | "equipe") => void }) {
  const allTasks = [...project.tasks, ...project.stages.flatMap((s) => [...s.tasks, ...s.activities.flatMap((a) => a.tasks)])];
  const now = new Date();
  const overdueTasks = allTasks.filter((t) => t.dueDate && !isFinished(t.status) && new Date(t.dueDate) < now);
  const overdueDeliverables = project.deliverables.filter((d) => d.expectedEnd && (d.status === "PLANNED" || d.status === "IN_PROGRESS") && new Date(d.expectedEnd) < now);
  const delivered = project.deliverables.filter((d) => d.status === "DELIVERED" || d.status === "VALIDATED").length;
  const statusCounts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CLOSED: 0 } as Record<"TODO" | "IN_PROGRESS" | "DONE" | "CLOSED", number>;
  for (const t of allTasks) statusCounts[t.status]++;
  const stageById = new Map(project.stages.map((s) => [s.id, s]));
  const memberById = new Map(project.members.map((m) => [m.id, m]));
  const color = project.color ?? "#4f5ff0";

  const planningRows = [
    ...project.stages.map((s) => ({
      name: s.name,
      start: s.startDate,
      end: s.dueDate,
      color,
      percent: s.progress.percent,
      kind: "stage" as const,
      detail: `${s.progress.done}/${s.progress.total} tâches terminées`,
    })),
    ...project.deliverables.map((d) => ({
      name: d.name,
      start: d.expectedStart,
      end: d.expectedEnd,
      color: DELIVERABLE_STATUS_COLOR[d.status],
      percent: d.status === "DELIVERED" || d.status === "VALIDATED" ? 100 : d.status === "IN_PROGRESS" ? 50 : 0,
      kind: "deliverable" as const,
      detail: `${DELIVERABLE_STATUS_LABEL[d.status]}${d.assigneeId && memberById.get(d.assigneeId) ? ` · ${memberById.get(d.assigneeId)!.name}` : ""}`,
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<CheckCircle2 className="h-5 w-5" />} label="Avancement" value={`${project.progress.percent}%`} hint={`${project.progress.done}/${project.progress.total} tâches terminées`} />
        <Kpi icon={<ListTodo className="h-5 w-5" />} label="Tâches en cours" value={statusCounts.IN_PROGRESS} hint={`${statusCounts.TODO} à faire`} />
        <Kpi icon={<Package className="h-5 w-5" />} label="Livrables livrés" value={`${delivered}/${project.deliverables.length}`} hint={`${project.deliverables.filter((d) => d.status === "IN_PROGRESS").length} en cours`} />
        <Kpi
          icon={<AlertTriangle className="h-5 w-5" />}
          label="En retard"
          value={overdueTasks.length + overdueDeliverables.length}
          tone={overdueTasks.length + overdueDeliverables.length > 0 ? "danger" : "ok"}
          hint={`${overdueTasks.length} tâche${overdueTasks.length > 1 ? "s" : ""}, ${overdueDeliverables.length} livrable${overdueDeliverables.length > 1 ? "s" : ""}`}
        />
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Planning</h2>
        <p className="mb-2 text-xs text-muted">Étapes (barre pleine = part réalisée) et livrables 📦 selon leurs dates. Ligne rouge : aujourd&apos;hui.</p>
        <PlanningChart rows={planningRows} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="font-semibold">Avancement étape par étape</h2>
          {project.stages.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Aucune étape.{" "}
              <button onClick={() => onGoTo("plan")} className="font-medium text-brand-600 hover:underline">
                Construire le plan
              </button>
            </p>
          ) : (
            <ProgressBarsChart
              rows={project.stages.map((s) => ({ name: s.name, percent: s.progress.percent, color, detail: `${s.progress.done}/${s.progress.total} tâches terminées` }))}
            />
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Tâches par statut</h2>
          <StatusDonut height={220} slices={TASK_STATUSES.map((s) => ({ label: TASK_STATUS_LABEL[s], value: statusCounts[s], color: TASK_STATUS_COLOR[s] }))} />
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Statut des livrables</h2>
          <button onClick={() => onGoTo("livrables")} className="text-sm font-medium text-brand-600 hover:underline">
            Gérer
          </button>
        </div>
        {project.deliverables.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Aucun livrable déclaré.</p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <StatusDonut
              height={200}
              slices={(["PLANNED", "IN_PROGRESS", "DELIVERED", "VALIDATED"] as const).map((s) => ({
                label: DELIVERABLE_STATUS_LABEL[s],
                value: project.deliverables.filter((d) => d.status === s).length,
                color: DELIVERABLE_STATUS_COLOR[s],
              }))}
            />
            <ul className="divide-y divide-line lg:col-span-2">
              {project.deliverables.map((d) => {
                const m = d.assigneeId ? memberById.get(d.assigneeId) : null;
                const late = d.expectedEnd && (d.status === "PLANNED" || d.status === "IN_PROGRESS") && new Date(d.expectedEnd) < now;
                return (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <Badge tone={DELIVERABLE_STATUS_TONE[d.status]}>{DELIVERABLE_STATUS_LABEL[d.status]}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{d.name}</div>
                      <div className="truncate text-xs text-muted">
                        {d.stageId && stageById.get(d.stageId) ? `${stageById.get(d.stageId)!.name} · ` : ""}
                        {d.expectedEnd ? `attendu le ${formatDate(d.expectedEnd)}` : "sans échéance"}
                        {d.documents.length > 0 ? ` · ${d.documents.length} doc.` : ""}
                      </div>
                    </div>
                    {late && <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />}
                    {m && <Avatar id={m.id} name={m.name} color={m.color} size={24} />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {overdueTasks.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50/50 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="h-5 w-5" /> Tâches en retard
          </h2>
          <ul className="mt-2 divide-y divide-red-100">
            {overdueTasks.map((t) => {
              const m = t.assigneeId ? memberById.get(t.assigneeId) : null;
              return (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {m && <Avatar id={m.id} name={m.name} color={m.color} size={22} />}
                    <span className="shrink-0 text-xs text-danger">{formatDate(t.dueDate)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone = "neutral" }: { icon: React.ReactNode; label: string; value: number | string; hint?: string; tone?: "neutral" | "ok" | "danger" }) {
  const toneClass = { neutral: "bg-brand-50 text-brand-600", ok: "bg-green-50 text-green-700", danger: "bg-red-50 text-red-700" }[tone];
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
