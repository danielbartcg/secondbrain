"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, CalendarDays, CalendarRange, FileSpreadsheet, Presentation, ShieldAlert, FileText, LayoutDashboard, ListTree, Package, SquareKanban, Users, LayoutTemplate } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import { InlineEdit, ProgressBar, errorMessage, toInputDate, toast } from "@/components/ui";
import { STATUS_LABEL } from "./ProjectList";
import { ProjectBoard } from "./ProjectBoard";
import { ProjectKanbanTab } from "./ProjectKanbanTab";
import { ProjectGanttTab } from "./ProjectGanttTab";
import { ProjectMeetingsTab } from "./ProjectMeetingsTab";
import { ProjectRisksTab } from "./ProjectRisksTab";
import { ProjectDashboardTab } from "./ProjectDashboardTab";
import { TeamTab } from "./TeamTab";
import { DeliverablesTab } from "./DeliverablesTab";
import { DocumentsTab } from "./DocumentsTab";
import { NotesPreview } from "@/components/notes/NotesPreview";
import { PinButton } from "@/components/PinButton";
import { ProjectCustomFields } from "./ProjectCustomFields";
import { ApplyTemplateBanner } from "@/components/templates/TemplatePicker";

/**
 * Espace projet : en-tête commun + onglets (tableau de bord, plan, livrables,
 * documents, équipe). L'état du projet est partagé : toute mutation renvoie
 * le projet recalculé par l'API et remplace l'état.
 */

/** Les mutations de tâche renvoient `project: null` si la tâche n'a pas de projet : on recharge alors. */
export type Resp = { project: ProjectDto | null };
export type Run = (fn: () => Promise<Resp>) => Promise<void>;

const COLORS = ["#4f5ff0", "#1f9d55", "#d98a0b", "#d13b3b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b"];

type TabKey = "dashboard" | "plan" | "gantt" | "kanban" | "reunions" | "livrables" | "risques" | "documents" | "equipe";
const TABS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { key: "plan", label: "Plan", icon: ListTree },
  { key: "gantt", label: "Gantt", icon: CalendarRange },
  { key: "kanban", label: "Kanban", icon: SquareKanban },
  { key: "reunions", label: "Réunions", icon: CalendarClock },
  { key: "livrables", label: "Livrables", icon: Package },
  { key: "risques", label: "Risques", icon: ShieldAlert },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "equipe", label: "Équipe", icon: Users },
];

/** Projet type : seuls les onglets de structure (pas de dates, d'équipe, de réunions ni de documents). */
const TEMPLATE_TABS: TabKey[] = ["plan", "livrables", "risques"];
const tabsFor = (isTemplate: boolean) => (isTemplate ? TABS.filter((t) => TEMPLATE_TABS.includes(t.key)) : TABS);

function tabFromHash(isTemplate = false): TabKey {
  const fallback: TabKey = isTemplate ? "plan" : "dashboard";
  if (typeof window === "undefined") return fallback;
  const h = window.location.hash.replace("#", "") as TabKey;
  return tabsFor(isTemplate).some((t) => t.key === h) ? h : fallback;
}

export function ProjectWorkspace({ initial, currentUserId }: { initial: ProjectDto; currentUserId: string }) {
  const [project, setProject] = useState(initial);
  const [saving, setSaving] = useState(0);
  /** « Enregistré » ne s'affiche qu'après une première sauvegarde. */
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<TabKey>(initial.isTemplate ? "plan" : "dashboard");
  const tpl = project.isTemplate;
  const tabs = tabsFor(tpl);

  useEffect(() => {
    setTab(tabFromHash(initial.isTemplate));
    const onHash = () => setTab(tabFromHash(initial.isTemplate));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectTab = (key: TabKey) => {
    setTab(key);
    history.replaceState(null, "", `#${key}`);
  };

  const run = useCallback<Run>(
    async (fn) => {
      setSaving((s) => s + 1);
      try {
        const { project } = await fn();
        if (project) setProject(project);
        else {
          const r = await api.get<Resp>(`/projects/${initial.id}`);
          if (r.project) setProject(r.project);
        }
      } catch (e) {
        console.error(e);
        toast(errorMessage(e, "Enregistrement impossible."), "error");
        const { project } = await api.get<Resp>(`/projects/${initial.id}`).catch(() => ({ project: null }));
        if (project) setProject(project);
      } finally {
        setSaving((s) => s - 1);
        setSaved(true);
      }
    },
    [initial.id],
  );

  const patchProject = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/projects/${project.id}`, data));
  const isOwner = project.ownerId === currentUserId;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">
        <Link href={tpl ? "/admin/templates" : "/projects"} className="flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {tpl ? "Modèles" : "Projets"}
        </Link>
        <span className={`ml-auto text-xs ${saving ? "text-warn" : "text-faint"}`} role="status">{saving ? "Enregistrement…" : saved ? "Enregistré" : ""}</span>
        {!tpl && (
        <a
          href={`/api/v1/projects/${project.id}/export`}
          download
          title="Exporter tout le projet au format Excel (.xlsx)"
          className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink md:p-1.5"
        >
          <FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Export Excel</span>
        </a>
        )}
        {!tpl && (
        <a
          href={`/api/v1/projects/${project.id}/export-pptx`}
          download
          title="Exporter l'état des lieux du projet au format PowerPoint (.pptx), avec des encadrés à commenter"
          className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink md:p-1.5"
        >
          <Presentation className="h-4 w-4" /> <span className="hidden sm:inline">Export PowerPoint</span>
        </a>
        )}
        {!tpl && <PinButton kind="PROJECT" item={{ id: project.id, name: project.name, color: project.color }} withLabel />}
      </div>
      {tpl && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>Projet type (modèle).</b> Définissez la structure : étapes, activités, tâches (priorité, complexité, prérequis, notes), livrables et risques. Les dates,
            l&apos;équipe, les affectations et les statuts se renseignent dans chaque projet créé à partir de ce modèle.
          </span>
        </div>
      )}

      {/* En-tête */}
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-1" role="group" aria-label="Couleur du projet">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => patchProject({ color: c })}
                style={{ backgroundColor: c }}
                title={`Couleur ${c}`}
                aria-label={`Couleur ${c}`}
                aria-pressed={project.color === c}
                className={`h-7 w-7 rounded-full md:h-4 md:w-4 ${project.color === c ? "ring-2 ring-brand-500 ring-offset-1" : "opacity-60 hover:opacity-100"}`}
              />
            ))}
          </div>
          {!tpl && (
          <select
            value={project.status}
            onChange={(e) => patchProject({ status: e.target.value })}
            aria-label="Statut du projet"
            className="ml-auto rounded-lg border border-line-strong bg-surface px-2 py-1 text-base font-medium sm:text-xs"
          >
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          )}
        </div>
        <InlineEdit value={project.name} onSave={(name) => patchProject({ name })} as="h1" className="-mx-1.5 mt-2 block text-2xl font-semibold tracking-tight" />
        <InlineEdit
          value={project.description}
          onSave={(description) => patchProject({ description })}
          as="div"
          multiline
          placeholder="Ajouter une description…"
          className="-mx-1.5 mt-1 block whitespace-pre-wrap text-sm text-ink-2"
        />
        {!tpl && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <DateField label="Début" value={project.startDate} onChange={(v) => patchProject({ startDate: v })} />
          <DateField label="Échéance" value={project.dueDate} onChange={(v) => patchProject({ dueDate: v })} />
          <span className="text-xs text-muted">
            {project.memberCount} membre{project.memberCount > 1 ? "s" : ""} · {project.stageCount} étape{project.stageCount > 1 ? "s" : ""} · {project.deliverableCount} livrable
            {project.deliverableCount > 1 ? "s" : ""}
          </span>
        </div>
        )}
        {!tpl && <ProjectCustomFields values={project.customFields} onChange={(customFields) => patchProject({ customFields })} />}
        {!tpl && (
        <div className="mt-4 flex items-center gap-3">
          <ProgressBar percent={project.progress.percent} color={project.color} className="h-3" />
          <span className="shrink-0 text-sm font-semibold tabular-nums">{project.progress.percent}%</span>
        </div>
        )}
      </div>

      {/* Projet encore vide : partir d'un modèle (propriétaire). */}
      {!tpl && isOwner && project.stages.length === 0 && project.tasks.length === 0 && project.deliverables.length === 0 && project.folders.length === 0 && (
        <ApplyTemplateBanner kind="project" targetId={project.id} className="mt-4" onApplied={(r) => (r as Resp).project && setProject((r as Resp).project!)} />
      )}

      {/* Notes riches du projet (éditées dans « Prise de notes ») */}
      <NotesPreview html={project.notes} noteRef={`project:${project.id}`} title="Notes du projet" className="mt-4" />

      {/* Onglets */}
      <div className="scrollbar-none mt-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Sections du projet">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => selectTab(key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
            {key === "livrables" && project.deliverableCount > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-xs">{project.deliverableCount}</span>}
            {key === "documents" && project.documents.length > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-xs">{project.documents.length}</span>}
            {key === "equipe" && <span className="rounded-full bg-surface-3 px-1.5 text-xs">{project.memberCount}</span>}
          </button>
        ))}
      </div>

      <div className="mt-5" role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
        {tab === "dashboard" && <ProjectDashboardTab project={project} onGoTo={selectTab} />}
        {tab === "plan" && <ProjectBoard project={project} run={run} />}
        {tab === "gantt" && <ProjectGanttTab project={project} run={run} />}
        {tab === "reunions" && <ProjectMeetingsTab project={project} currentUserId={currentUserId} />}
        {tab === "risques" && <ProjectRisksTab project={project} canEdit />}
        {tab === "kanban" && <ProjectKanbanTab project={project} run={run} />}
        {tab === "livrables" && <DeliverablesTab project={project} run={run} />}
        {tab === "documents" && <DocumentsTab project={project} run={run} currentUserId={currentUserId} />}
        {tab === "equipe" && <TeamTab project={project} run={run} isOwner={isOwner} currentUserId={currentUserId} />}
      </div>
    </div>
  );
}

export function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-muted">
      <CalendarDays className="h-4 w-4" />
      <span>{label}</span>
      <input type="date" value={toInputDate(value)} onChange={(e) => onChange(e.target.value || null)} className="rounded border border-line bg-surface px-1.5 py-0.5 text-base text-ink sm:text-xs" />
    </label>
  );
}
