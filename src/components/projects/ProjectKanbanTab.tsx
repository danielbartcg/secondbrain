"use client";

import { useMemo } from "react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import { KanbanBoard, type KanbanTask } from "@/components/tasks/KanbanBoard";
import type { Resp, Run } from "./ProjectWorkspace";

/** Onglet Kanban du projet : toutes les tâches du projet par statut, glisser pour changer le statut. */
export function ProjectKanbanTab({ project, run }: { project: ProjectDto; run: Run }) {
  const tasks = useMemo<KanbanTask[]>(() => {
    const memberById = new Map(project.members.map((m) => [m.id, m]));
    const toCard = (t: ProjectDto["tasks"][number], context: string | null): KanbanTask => {
      const m = t.assigneeId ? memberById.get(t.assigneeId) : null;
      return { id: t.id, name: t.name, status: t.status, priority: t.priority, dueDate: t.dueDate, progress: t.progress, context, contextColor: project.color, assignee: m ? { id: m.id, name: m.name, color: m.color, avatarUrl: m.avatarUrl } : null, commentCount: t.commentCount };
    };
    return [
      ...project.tasks.map((t) => toCard(t, "Sans étape")),
      ...project.stages.flatMap((s) => [...s.tasks.map((t) => toCard(t, s.name)), ...s.activities.flatMap((a) => a.tasks.map((t) => toCard(t, `${s.name} › ${a.name}`)))]),
    ];
  }, [project]);

  return (
    <div>
      <p className="mb-3 text-xs text-muted">Glissez une carte d&apos;une colonne à l&apos;autre pour changer son statut ; cliquez le titre pour ouvrir la fiche.</p>
      <KanbanBoard tasks={tasks} onMove={(id, status) => run(() => api.patch<Resp>(`/tasks/${id}`, { status }))} emptyHint="Aucune tâche dans ce projet : ajoutez-en depuis le Plan." />
    </div>
  );
}
