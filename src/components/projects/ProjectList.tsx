"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarDays, FolderKanban, GripVertical, Inbox, Moon, Plus, Tags, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto, ProjectSummary } from "@/lib/projects";
import type { StaleOverview } from "@/lib/freshness";
import { Button, EmptyState, InlineEdit, PageHeader, ProgressBar, errorMessage, formatDate, toast } from "@/components/ui";
import { mutateProjectTypes, useProjectTypes } from "@/lib/project-types-store";
import { saveItemOrder, sortByOrder, sortedIds, useItemOrder } from "@/lib/item-order-store";
import { SortMenu } from "@/components/SortMenu";
import { IconButton } from "@/components/icons/IconButton";
import { groupByType, moveId, type ProjectTypeDto, type ProjectTypesDto } from "@/lib/shared/project-types";
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

const PROJECT_DRAG = "application/x-sb-project";
const TYPE_DRAG = "application/x-sb-project-type";
type PT = { projectTypes: ProjectTypesDto };

/**
 * Liste des projets, groupée par **type de projet** personnel : projets sans
 * type en haut, puis une carte par type (ordre choisi) ; dans chaque groupe,
 * l'**ordre personnel** (`useItemOrder`, aussi celui des épingles du menu),
 * réglable par « Trier » (A → Z, mise à jour) puis glisser-déposer.
 * Glisser-déposer (souris) : un projet sur un autre (placé avant lui, rangé
 * dans son type), vers un autre type (ou vers le haut pour retirer le type),
 * un type (poignée) avant un autre ; au clavier et au doigt :
 * sélecteur « Type » sur chaque projet, flèches monter / descendre sur chaque
 * type. « Sans projet » ne se range pas. Classement propre à chacun
 * (`/api/v1/me/project-types`).
 *
 * `currentUserId` (facultatif) : seule la personne propriétaire voit
 * l'action « Supprimer » ; sans identifiant, l'action reste affichée et le
 * serveur tranche.
 */
export function ProjectList({
  initial,
  orphanCount = 0,
  currentUserId,
  projectTypes: initialTypes,
  order: initialOrder,
}: {
  initial: ProjectSummary[];
  orphanCount?: number;
  currentUserId?: string;
  projectTypes?: ProjectTypesDto;
  /** Ordre personnel (identifiants), fourni par la page. */
  order?: string[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const types = useProjectTypes(initialTypes);
  const order = useItemOrder("PROJECT", initialOrder);
  const [newType, setNewType] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<"project" | "type" | null>(null);
  const [over, setOver] = useState<string | null>(null);
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

  async function setIcon(p: ProjectSummary, icon: string | null) {
    const previous = projects;
    setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, icon } : x)));
    try {
      await api.patch(`/projects/${p.id}`, { icon });
    } catch (err) {
      setProjects(previous);
      toast(errorMessage(err, "Icône non enregistrée."), "error");
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
  const groups = groupByType(sortByOrder(visible, order), types, true);

  /** Trie toute la liste (A → Z ou mise à jour) : devient l'ordre personnel, glisser-déposer pour ajuster. */
  function sortAll(by: "alpha" | "updated") {
    return saveItemOrder("PROJECT", sortedIds(projects, by, (p) => p.name)).catch(fail);
  }
  /** Projet déposé sur un autre : placé juste avant lui (et rangé dans son type). */
  function dropOnProject(e: React.DragEvent, target: ProjectSummary) {
    const projectId = e.dataTransfer.getData(PROJECT_DRAG);
    if (!projectId) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    endDrag();
    if (projectId === target.id) return;
    const ids = sortByOrder(projects, order).map((p) => p.id);
    void saveItemOrder("PROJECT", moveId(ids, projectId, target.id)).catch(fail);
    const targetType = typeOf(target.id);
    if (typeOf(projectId) !== targetType) void assign(projectId, targetType);
  }
  const typeOf = (id: string) => (types.types.some((t) => t.id === types.assignments[id]) ? types.assignments[id] : null);

  const fail = (e: unknown) => toast(errorMessage(e), "error");

  function assign(projectId: string, typeId: string | null) {
    if (typeOf(projectId) === typeId) return;
    const assignments = { ...types.assignments };
    if (typeId) assignments[projectId] = typeId;
    else delete assignments[projectId];
    return mutateProjectTypes({ ...types, assignments }, () => api.put<PT>("/me/project-types/assign", { projectId, typeId })).catch(fail);
  }

  function reorder(ids: string[]) {
    const byId = new Map(types.types.map((t) => [t.id, t]));
    return mutateProjectTypes({ ...types, types: ids.map((id) => byId.get(id)!) }, () => api.put<PT>("/me/project-types/order", { ids })).catch(fail);
  }

  function moveType(id: string, delta: number) {
    const ids = types.types.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return reorder(ids);
  }

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    const name = (newType ?? "").trim();
    if (!name) return;
    try {
      await mutateProjectTypes(null, () => api.post<PT>("/me/project-types", { name }));
      setNewType("");
      toast(`Type « ${name} » créé : glissez-y des projets.`, "ok");
    } catch (err) {
      fail(err);
    }
  }

  function renameType(id: string, name: string) {
    const n = name.trim().slice(0, 60);
    if (!n) return;
    return mutateProjectTypes({ ...types, types: types.types.map((t) => (t.id === id ? { ...t, name: n } : t)) }, () => api.patch<PT>(`/me/project-types/${id}`, { name: n })).catch(fail);
  }

  function removeType(t: ProjectTypeDto) {
    const count = Object.values(types.assignments).filter((x) => x === t.id).length;
    if (!confirm(`Supprimer le type « ${t.name} » ?${count ? ` Ses ${count} projet${count > 1 ? "s" : ""} redeviendront sans type.` : ""}`)) return;
    const assignments = Object.fromEntries(Object.entries(types.assignments).filter(([, v]) => v !== t.id));
    return mutateProjectTypes({ types: types.types.filter((x) => x.id !== t.id), assignments }, () => api.delete<PT>(`/me/project-types/${t.id}`)).catch(fail);
  }

  // --- Glisser-déposer (souris) ---
  function allowDrop(e: React.DragEvent, target: string, isType: boolean) {
    const kinds = e.dataTransfer.types;
    if (kinds.includes(PROJECT_DRAG) || (isType && kinds.includes(TYPE_DRAG))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== target) setOver(target);
    }
  }
  function drop(e: React.DragEvent, typeId: string | null) {
    e.preventDefault();
    setOver(null);
    const projectId = e.dataTransfer.getData(PROJECT_DRAG);
    const draggedType = e.dataTransfer.getData(TYPE_DRAG);
    if (projectId) void assign(projectId, typeId);
    else if (draggedType && typeId && draggedType !== typeId) {
      const ids = types.types.map((t) => t.id);
      // Déposé sur un type placé après : se range après lui ; avant : avant lui.
      const after = ids.indexOf(draggedType) < ids.indexOf(typeId);
      const target = after ? (ids[ids.indexOf(typeId) + 1] ?? null) : typeId;
      void reorder(moveId(ids, draggedType, target));
    }
    endDrag();
  }
  function endDrag() {
    setDragging(null);
    setDragKind(null);
    setOver(null);
  }

  return (
    <>
      <PageHeader
        title="Projets"
        subtitle="Étapes › activités › tâches : l'avancement se saisit sur les tâches et remonte."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setNewType((v) => (v === null ? "" : null))} aria-expanded={newType !== null}>
              <Tags className="h-4 w-4" /> Types de projet
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Nouveau projet
            </Button>
          </div>
        }
      />

      {newType !== null && (
        <form onSubmit={addType} className="mb-6 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">
            Vos types de projet (« Client », « Interne », « Marketing »…) regroupent la liste des projets et, au-delà de 5 épingles, le menu. Ils vous sont propres :
            les autres membres ne les voient pas. Glissez les projets d&apos;un type à l&apos;autre, et les types entre eux pour changer leur ordre.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              autoFocus
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              maxLength={60}
              placeholder="Nouveau type, ex. Projet client"
              aria-label="Nom du nouveau type de projet"
              className="min-w-[12rem] flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-sm"
            />
            <Button type="submit" disabled={!newType.trim()}>
              <Plus className="h-4 w-4" /> Ajouter le type
            </Button>
            <Button variant="ghost" onClick={() => setNewType(null)}>
              Fermer
            </Button>
          </div>
        </form>
      )}

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

      <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
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
      <SortMenu onSort={sortAll} />
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

      {visible.length === 0 && types.types.length === 0 ? (
        <EmptyState title="Aucun projet ici" hint="Créez un projet, puis découpez-le en étapes et en tâches.">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Créer un projet
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) =>
            g.type === null ? (
              // Projets sans type : tout en haut, sans cadre (zone de dépôt pendant un glisser).
              <div
                key="untyped"
                onDragOver={(e) => allowDrop(e, "untyped", false)}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => drop(e, null)}
                className={over === "untyped" ? "rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-canvas" : undefined}
              >
                {g.items.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2">{g.items.map(card)}</ul>
                ) : dragKind === "project" ? (
                  <p className="rounded-2xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">Déposer ici pour retirer le type</p>
                ) : null}
              </div>
            ) : (
              <section
                key={g.type.id}
                onDragOver={(e) => allowDrop(e, g.type!.id, true)}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => drop(e, g.type!.id)}
                aria-label={`Type de projet ${g.type.name}`}
                className={`rounded-2xl border bg-surface-2/50 p-3 transition sm:p-4 ${over === g.type.id ? "border-brand-500 ring-2 ring-brand-500" : "border-line"} ${dragging === g.type.id ? "opacity-50" : ""}`}
              >
                <header className="mb-3 flex items-center gap-2">
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TYPE_DRAG, g.type!.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(g.type!.id);
                      setDragKind("type");
                    }}
                    onDragEnd={endDrag}
                    className="cursor-grab rounded p-1 text-faint hover:bg-surface-3 hover:text-ink active:cursor-grabbing max-md:hidden"
                    title="Glisser pour réordonner les types"
                    aria-hidden
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <Tags className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <InlineEdit value={g.type.name} onSave={(name) => void renameType(g.type!.id, name)} className="-mx-1.5 min-w-0 font-semibold" as="h2" />
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-ink-2">{g.items.length}</span>
                  <div className="ml-auto flex items-center">
                    <button type="button" disabled={gi <= 1} onClick={() => void moveType(g.type!.id, -1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 disabled:opacity-30" title="Monter" aria-label={`Monter le type ${g.type.name}`}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={gi === groups.length - 1} onClick={() => void moveType(g.type!.id, 1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 disabled:opacity-30" title="Descendre" aria-label={`Descendre le type ${g.type.name}`}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void removeType(g.type!)} className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger" title="Supprimer le type" aria-label={`Supprimer le type ${g.type.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </header>
                {g.items.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2">{g.items.map(card)}</ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">
                    {filter === "ALL" ? "Glissez un projet ici (ou choisissez ce type sur sa carte)." : "Aucun projet de ce type avec ce statut."}
                  </p>
                )}
              </section>
            ),
          )}
          {visible.length === 0 && <p className="text-center text-sm text-muted">Aucun projet avec ce statut.</p>}
        </div>
      )}
    </>
  );

  function card(p: ProjectSummary) {
    return (
      <li
        key={p.id}
        draggable
        onDragStart={(e) => {
          if ((e.target as Element).closest("a,button,select,input")) return;
          e.dataTransfer.setData(PROJECT_DRAG, p.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(p.id);
          setDragKind("project");
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PROJECT_DRAG)) return;
          e.preventDefault();
          e.stopPropagation();
          if (over !== `p:${p.id}`) setOver(`p:${p.id}`);
        }}
        onDrop={(e) => dropOnProject(e, p)}
        className={`group relative cursor-grab rounded-2xl border bg-surface p-4 transition-shadow hover:shadow-md active:cursor-grabbing ${dragging === p.id ? "opacity-50" : ""} ${over === `p:${p.id}` && dragging !== p.id ? "border-brand-500 shadow-[-4px_0_0_0_var(--color-brand-500)]" : "border-line"}`}
      >
        <div className="flex items-start gap-3">
          <IconButton
            icon={p.icon}
            fallback={FolderKanban}
            title={p.name}
            onChange={(icon) => setIcon(p, icon)}
            boxClassName="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white"
            style={{ backgroundColor: p.color ?? "var(--color-brand-600)" }}
          />
          <div className="min-w-0 flex-1">
            <Link href={`/projects/${p.id}`} draggable={false} className="block truncate font-semibold hover:text-brand-700">
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
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {p.progress.done}/{p.progress.total} tâche{p.progress.total > 1 ? "s" : ""} terminée{p.progress.done > 1 ? "s" : ""}
          </p>
          {types.types.length > 0 && (
            <label className="flex min-w-0 items-center gap-1 text-xs text-muted">
              <Tags className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <select
                value={typeOf(p.id) ?? ""}
                onChange={(e) => void assign(p.id, e.target.value || null)}
                aria-label={`Type du projet « ${p.name} »`}
                className="max-w-[10rem] truncate rounded-md border border-transparent bg-transparent py-0.5 pr-1 text-xs text-ink-2 hover:border-line focus:border-brand-500"
              >
                <option value="">Sans type</option>
                {types.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </li>
    );
  }
}
