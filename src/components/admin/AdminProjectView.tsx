"use client";

import Link from "next/link";
import { ArrowLeft, Eye, Layers, ListChecks } from "lucide-react";
import type { ProjectDto, TaskDto } from "@/lib/projects";
import { STATUS_LABEL } from "@/components/projects/ProjectList";
import { Avatar, Badge, PriorityFlag, ProgressBar, TASK_STATUS_LABEL, TASK_STATUS_TONE, formatDate } from "@/components/ui";

/** Projet quelconque en lecture seule : équipe, étapes › activités › tâches (liens vers les fiches en consultation). */
export function AdminProjectView({ project }: { project: ProjectDto & { ownerName: string } }) {
  const memberById = new Map(project.members.map((m) => [m.id, m]));

  const TaskLine = ({ t }: { t: TaskDto }) => {
    const m = t.assigneeId ? memberById.get(t.assigneeId) : null;
    return (
      <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <PriorityFlag priority={t.priority} />
        <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate hover:underline">
          {t.name}
        </Link>
        {t.dueDate && <span className="hidden text-xs text-muted sm:inline">{formatDate(t.dueDate)}</span>}
        <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
        {m && <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={22} />}
      </li>
    );
  };

  return (
    <div>
      <Link href="/admin/projects" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Tous les projets
      </Link>
      <p className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <Eye className="h-4 w-4 shrink-0" /> Consultation en lecture seule.
      </p>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color ?? "var(--color-brand-600)" }} />
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <Badge tone="neutral">{STATUS_LABEL[project.status]}</Badge>
          <span className="ml-auto text-xs text-muted">Propriétaire : {project.ownerName}</span>
        </div>
        {project.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{project.description}</p>}
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar percent={project.progress.percent} color={project.color} className="h-2.5" />
          <span className="text-sm font-semibold tabular-nums">{project.progress.percent}%</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {project.members.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs">
              <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={22} /> {m.name}
              {m.role && <span className="text-muted">· {m.role}</span>}
            </span>
          ))}
        </div>
      </section>

      {project.tasks.length > 0 && (
        <section className="mt-4 rounded-2xl border border-line bg-surface">
          <h3 className="border-b border-line px-3 py-2 text-sm font-semibold">Tâches sans étape</h3>
          <ul className="divide-y divide-line">
            {project.tasks.map((t) => (
              <TaskLine key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}
      {project.stages.map((s) => (
        <section key={s.id} className="mt-4 rounded-2xl border border-line bg-surface">
          <h3 className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-muted" /> {s.name}
            <span className="ml-auto text-xs font-normal text-muted">
              {s.progress.percent}% · {s.progress.done}/{s.progress.total}
            </span>
          </h3>
          <ul className="divide-y divide-line">
            {s.tasks.map((t) => (
              <TaskLine key={t.id} t={t} />
            ))}
          </ul>
          {s.activities.map((a) => (
            <div key={a.id} className="border-t border-line">
              <h4 className="flex items-center gap-2 bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-ink-2">
                <ListChecks className="h-3.5 w-3.5" /> {a.name}
              </h4>
              <ul className="divide-y divide-line">
                {a.tasks.map((t) => (
                  <TaskLine key={t.id} t={t} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
