"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, FolderKanban, Inbox, Moon, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto, ProjectSummary } from "@/lib/projects";
import type { StaleOverview } from "@/lib/freshness";
import { Button, EmptyState, PageHeader, ProgressBar, errorMessage, formatDate } from "@/components/ui";
import { PinButton } from "@/components/PinButton";
import { CustomFieldChips } from "./ProjectCustomFields";
import { TemplateSelect } from "@/components/templates/TemplatePicker";

export const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  ACTIVE: "Actif",
  ON_HOLD: "En pause",
  DONE: "Terminé",
  ARCHIVED: "Archivé",
};

const STATUS_CLASS: Record<ProjectSummary["status"], string> = {
  ACTIVE: "bg-brand-50 text-brand-700",
  ON_HOLD: "bg-amber-50 text-amber-700",
  DONE: "bg-green-50 text-green-700",
  ARCHIVED: "bg-surface-3 text-muted",
};

type Filter = "ALL" | ProjectSummary["status"];

/**
 * `currentUserId` (facultatif) : seule la personne propriétaire voit
 * l'action « Supprimer » ; sans identifiant, l'action reste affichée et le
 * serveur tranche.
 */
export function ProjectList({ initial, orphanCount = 0, currentUserId }: { initial: ProjectSummary[]; orphanCount?: number; currentUserId?: string }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fraîcheur : projets actifs sans activité depuis N jours (en ligne, silencieux sinon).
  const [stale, setStale] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let alive = true;
    api
      .get<{ stale: StaleOverview }>("/me/stale")
      .then((r) => alive && setStale(new Map(r.stale.projects.map((p) => [p.id, p.idleDays]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.post<{ project: ProjectDto }>("/projects", { name: n, ...(templateId ? { templateId } : {}) });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(errorMessage(err, "Création impossible."));
      setBusy(false);
    }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`Supprimer le projet « ${p.name} » (étapes, activités et tâches comprises) ?`)) return;
    const previous = projects;
    setError(null);
    setProjects((ps) => ps.filter((x) => x.id !== p.id));
    try {
      await api.delete(`/projects/${p.id}`);
    } catch (err) {
      setProjects(previous);
      setError(errorMessage(err, "Suppression impossible."));
    }
  }

  const visible = projects.filter((p) => (filter === "ALL" ? p.status !== "ARCHIVED" : p.status === filter));

  return (
    <>
      <PageHeader
        title="Projets"
        subtitle="Étapes › activités › tâches : l'avancement se saisit sur les tâches et remonte."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouveau projet
          </Button>
        }
      />

      {creating && (
        <form onSubmit={create} className="mb-6 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:flex-wrap">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du projet"
            aria-label="Nom du projet"
            className="min-w-[12rem] flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-sm"
          />
          <TemplateSelect kind="project" value={templateId} onChange={setTemplateId} className="sm:max-w-sm" />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Création…" : "Créer"}
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="scrollbar-none mb-4 flex gap-1 overflow-x-auto">
        {(["ALL", "ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${filter === f ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
          >
            {f === "ALL" ? "Tous" : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Projet virtuel : tâches sans projet */}
      {(filter === "ALL" || filter === "ACTIVE") && (
        <Link href="/projects/sans-projet" className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4 transition-shadow hover:shadow-md">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2">
            <Inbox className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Sans projet</span>
            <span className="block text-xs text-muted">Vos tâches orphelines, rattachables plus tard à un projet.</span>
          </span>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-ink-2">
            {orphanCount} tâche{orphanCount > 1 ? "s" : ""}
          </span>
        </Link>
      )}

      {visible.length === 0 ? (
        <EmptyState title="Aucun projet ici" hint="Créez un projet, puis découpez-le en étapes et en tâches.">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Créer un projet
          </Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((p) => (
            <li key={p.id} className="group relative rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: p.color ?? "var(--color-brand-600)" }}>
                  <FolderKanban className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/projects/${p.id}`} className="block truncate font-semibold hover:text-brand-700">
                    {p.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    {stale.has(p.id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800" title={`Aucune activité depuis ${stale.get(p.id)} jours`}>
                        <Moon className="h-3 w-3" aria-hidden /> Endormi · {stale.get(p.id)} j
                      </span>
                    )}
                    <span>
                      {p.stageCount} étape{p.stageCount > 1 ? "s" : ""}
                    </span>
                    {p.dueDate && (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> {formatDate(p.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
                <PinButton kind="PROJECT" item={{ id: p.id, name: p.name, color: p.color }} />
                {(!currentUserId || p.ownerId === currentUserId) && (
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    title="Supprimer"
                    aria-label={`Supprimer le projet « ${p.name} »`}
                    className="rounded-lg p-2 text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-danger group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 md:p-1.5"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {p.description && <p className="mt-3 line-clamp-2 text-sm text-ink-2">{p.description}</p>}
              <CustomFieldChips values={p.customFields} />
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar percent={p.progress.percent} color={p.color} />
                <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{p.progress.percent}%</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {p.progress.done}/{p.progress.total} tâche{p.progress.total > 1 ? "s" : ""} terminée{p.progress.done > 1 ? "s" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
