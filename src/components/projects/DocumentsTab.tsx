"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Download, FileText, Folder, FolderOpen, FolderPlus, GripVertical, Home, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/client";
import type { FolderDto, ProjectDto } from "@/lib/projects";
import { Button, InlineEdit, QuickAdd, formatBytes, formatDate, selectClassXs, toast } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/**
 * Explorateur documentaire du projet : arborescence de dossiers (fil d'Ariane,
 * sous-dossiers, documents du dossier courant), dépôt dans le dossier courant,
 * déplacement de documents et de dossiers, rattachement à un livrable.
 *
 * Déplacement :
 *  - à la souris, glisser-déposer HTML5 d'un document (ou de la sélection,
 *    Ctrl/⌘-clic et Maj-clic) ou d'un dossier sur une tuile de dossier ou un
 *    segment du fil d'Ariane (« Documents » = racine) ;
 *  - au clavier / au toucher, listes « Déplacer vers… » (par ligne et pour la
 *    sélection, cochée via les cases).
 * Les glisser internes portent un type MIME propre (`application/x-sb-*`) :
 * la zone de dépôt ne téléverse que les fichiers venant du système.
 */

const DOC_MIME = "application/x-sb-document";
const FOLDER_MIME = "application/x-sb-folder";
const ROOT = "__root__";

type DragItem = { kind: "docs"; ids: string[] } | { kind: "folder"; id: string };

/** Chemin lisible d'un dossier (« Racine / A / B »). */
function folderPath(folders: FolderDto[], id: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  for (let cur = id; cur; cur = byId.get(cur)?.parentId ?? null) {
    const f = byId.get(cur);
    if (!f) break;
    names.unshift(f.name);
    if (names.length > 20) break;
  }
  return names.length ? names.join(" / ") : "Racine";
}

/** Identifiants d'un dossier et de toute sa descendance. */
function subtree(folders: FolderDto[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grown = true;
  while (grown) {
    grown = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grown = true;
      }
    }
  }
  return out;
}

/** Dossiers en ordre arborescent (profondeur d'abord, tri alphabétique), avec leur profondeur. */
function folderTree(folders: FolderDto[]): { id: string; name: string; depth: number }[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, FolderDto[]>();
  for (const f of folders) {
    // Parent inconnu : rangé à la racine pour rester accessible.
    const key = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    children.set(key, [...(children.get(key) ?? []), f]);
  }
  const out: { id: string; name: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, "fr"))) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const indent = (depth: number) => " ".repeat(depth);

/** Vrai si le glisser en cours provient de l'explorateur (et non du système). */
function isInternalDrag(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(DOC_MIME) || types.includes(FOLDER_MIME);
}

const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

export function DocumentsTab({ project, run, currentUserId }: { project: ProjectDto; run: Run; currentUserId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  /** Élément glissé (les données du dataTransfer ne sont lisibles qu'au dépôt). */
  const dragRef = useRef<DragItem | null>(null);
  const [internalDrag, setInternalDrag] = useState(false);
  /** Cible survolée : id de dossier ou ROOT. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const folders = project.folders;
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  // Dossier courant supprimé entre-temps : retour à la racine.
  const currentId = current && byId.has(current) ? current : null;
  const breadcrumb = useMemo(() => {
    const trail: FolderDto[] = [];
    for (let cur = currentId; cur; cur = byId.get(cur)?.parentId ?? null) {
      const f = byId.get(cur);
      if (!f) break;
      trail.unshift(f);
    }
    return trail;
  }, [currentId, byId]);
  const subfolders = folders.filter((f) => f.parentId === currentId).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const docs = project.documents.filter((d) => (d.folderId ?? null) === currentId);
  const docById = useMemo(() => new Map(project.documents.map((d) => [d.id, d])), [project.documents]);
  const deliverableName = new Map(project.deliverables.map((d) => [d.id, d.name]));
  const countIn = (folderId: string) => {
    const ids = subtree(folders, folderId);
    return project.documents.filter((d) => d.folderId && ids.has(d.folderId)).length;
  };
  const tree = useMemo(() => folderTree(folders), [folders]);
  // Sélection limitée aux documents visibles (un document déplacé ou supprimé en sort).
  const selectedDocs = docs.filter((d) => selected.has(d.id));

  function open(id: string | null) {
    setCurrent(id);
    setSelected(new Set());
    anchorRef.current = null;
  }

  async function upload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        if (currentId) form.append("folderId", currentId);
        await run(() => api.post<Resp>(`/projects/${project.id}/documents`, form));
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Déplace des documents (ceux déjà dans la cible sont ignorés). */
  async function moveDocs(ids: string[], target: string | null) {
    const toMove = ids.filter((id) => {
      const d = docById.get(id);
      return d && (d.folderId ?? null) !== target;
    });
    if (toMove.length === 0) return;
    let ok = false;
    await run(async () => {
      let last: Resp = { project: null };
      for (const id of toMove) last = await api.patch<Resp>(`/documents/${id}`, { folderId: target });
      ok = true;
      return last;
    });
    if (ok) {
      setSelected((s) => {
        const next = new Set(s);
        for (const id of toMove) next.delete(id);
        return next;
      });
      toast(`${toMove.length > 1 ? `${toMove.length} documents déplacés` : "Document déplacé"} vers « ${folderPath(folders, target)} ».`);
    }
  }

  /** Un dossier ne peut aller ni sur lui-même, ni dans sa descendance, ni là où il est déjà. */
  function canMoveFolder(id: string, target: string | null): boolean {
    const f = byId.get(id);
    if (!f || (f.parentId ?? null) === target) return false;
    return !(target && subtree(folders, id).has(target));
  }

  async function moveFolder(id: string, target: string | null) {
    if (!canMoveFolder(id, target)) return;
    await run(() => api.patch<Resp>(`/folders/${id}`, { parentId: target }));
  }

  function canDrop(target: string | null): boolean {
    const item = dragRef.current;
    if (!item) return false;
    if (item.kind === "folder") return canMoveFolder(item.id, target);
    return item.ids.some((id) => {
      const d = docById.get(id);
      return d && (d.folderId ?? null) !== target;
    });
  }

  /** Gestionnaires de dépôt d'une cible (tuile de dossier, segment du fil d'Ariane). */
  function dropProps(target: string | null) {
    const key = target ?? ROOT;
    return {
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!isInternalDrag(e) || !canDrop(target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDropTarget((t) => (t === key ? null : t));
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        if (!isInternalDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        const item = dragRef.current;
        dragRef.current = null;
        setInternalDrag(false);
        if (!item) return;
        if (item.kind === "folder") void moveFolder(item.id, target);
        else void moveDocs(item.ids, target);
      },
    };
  }

  function startDrag(e: React.DragEvent<HTMLElement>, item: DragItem) {
    dragRef.current = item;
    e.dataTransfer.effectAllowed = "move";
    if (item.kind === "folder") e.dataTransfer.setData(FOLDER_MIME, item.id);
    else e.dataTransfer.setData(DOC_MIME, JSON.stringify(item.ids));
    setInternalDrag(true);
  }

  function endDrag() {
    dragRef.current = null;
    setInternalDrag(false);
    setDropTarget(null);
  }

  const dropRing = (key: string) => (dropTarget === key ? "ring-2 ring-brand-500 bg-brand-50" : "");

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }

  /** Ctrl/⌘-clic : bascule ; Maj-clic : plage depuis le dernier document cliqué. */
  function onRowClick(e: React.MouseEvent<HTMLElement>, id: string) {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
    if (e.shiftKey && anchorRef.current) {
      const a = docs.findIndex((d) => d.id === anchorRef.current);
      const b = docs.findIndex((d) => d.id === id);
      if (a >= 0 && b >= 0) {
        e.preventDefault();
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected((s) => new Set([...s, ...docs.slice(from, to + 1).map((d) => d.id)]));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggle(id);
    }
  }

  const targetOptions = (exclude?: Set<string>) =>
    tree
      .filter((o) => !exclude?.has(o.id))
      .map((o) => (
        <option key={o.id} value={o.id}>
          {indent(o.depth + 1)}📁 {o.name}
        </option>
      ));

  return (
    <div className="space-y-4">
      {/* Fil d'Ariane (cibles de dépôt) + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Dossiers" className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
          <button
            onClick={() => open(null)}
            {...dropProps(null)}
            title={internalDrag ? "Déposer à la racine du projet" : undefined}
            className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 ${currentId ? "text-muted hover:bg-surface-2 hover:text-ink" : "bg-surface-2 font-medium"} ${dropRing(ROOT)}`}
          >
            <Home className="h-4 w-4" /> Documents
          </button>
          {breadcrumb.map((f, i) => (
            <span key={f.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 text-faint" />
              <button
                onClick={() => open(f.id)}
                {...dropProps(f.id)}
                className={`rounded-lg px-2 py-1 ${i === breadcrumb.length - 1 ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2 hover:text-ink"} ${dropRing(f.id)}`}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
        <Button size="sm" variant="outline" onClick={() => setAddingFolder((v) => !v)}>
          <FolderPlus className="h-4 w-4" /> Dossier
        </Button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4" /> {uploading ? "Envoi…" : "Téléverser ici"}
        </Button>
      </div>

      {addingFolder && (
        <QuickAdd
          autoFocus
          placeholder={`Nom du nouveau dossier dans « ${currentId ? folderPath(folders, currentId) : "Racine"} »`}
          onAdd={async (name) => {
            await run(() => api.post<Resp>(`/projects/${project.id}/folders`, { name, parentId: currentId }));
            setAddingFolder(false);
          }}
        />
      )}

      {/* Zone de dépôt (fichiers du système uniquement) */}
      <div
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-3 text-center text-xs transition-colors ${dragging ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line-strong text-muted"}`}
      >
        <span className="sm:hidden">Touchez « Téléverser ici » pour ajouter des fichiers dans « {currentId ? folderPath(folders, currentId) : "Racine"} » (25 Mo max)</span>
        <span className="hidden sm:inline">
          {internalDrag
            ? "Déposez sur un dossier ou sur le fil d'Ariane (« Documents » = racine) pour déplacer."
            : `Glissez des fichiers ici pour les déposer dans « ${currentId ? folderPath(folders, currentId) : "Racine"} » (PDF, Office, images, zip… 25 Mo max). Glissez un document ou un dossier sur un dossier pour l'y ranger.`}
        </span>
      </div>

      {/* Sous-dossiers (glissables et cibles de dépôt) */}
      {subfolders.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((f) => (
            <li
              key={f.id}
              draggable
              onDragStart={(e) => startDrag(e, { kind: "folder", id: f.id })}
              onDragEnd={endDrag}
              {...dropProps(f.id)}
              className={`group flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 transition-shadow ${dropRing(f.id)}`}
            >
              {/* Ouvrir (icône, compteur) et renommer (titre) sont des contrôles distincts. */}
              <button type="button" onClick={() => open(f.id)} className="shrink-0 rounded-lg p-1.5 hover:bg-surface-2" title="Ouvrir le dossier" aria-label={`Ouvrir le dossier « ${f.name} »`}>
                <Folder className="h-5 w-5 text-warn" />
              </button>
              <div className="min-w-0 flex-1">
                <InlineEdit value={f.name} onSave={(name) => run(() => api.patch<Resp>(`/folders/${f.id}`, { name }))} className="-mx-1.5 block truncate text-sm font-medium" />
                <button type="button" onClick={() => open(f.id)} className="block text-left text-xs text-muted hover:text-ink hover:underline">
                  {countIn(f.id)} document{countIn(f.id) > 1 ? "s" : ""} · ouvrir
                </button>
              </div>
              <select
                value=""
                onChange={(e) => {
                  const target = e.target.value;
                  if (target === "") return;
                  void moveFolder(f.id, target === ROOT ? null : target);
                }}
                className={`${selectClassXs} max-w-36`}
                title="Déplacer le dossier vers…"
                aria-label={`Déplacer le dossier « ${f.name} » vers…`}
              >
                <option value="">Déplacer vers…</option>
                {f.parentId !== null && <option value={ROOT}>🏠 Racine du projet</option>}
                {targetOptions(new Set([...subtree(folders, f.id), ...(f.parentId ? [f.parentId] : [])]))}
              </select>
              <button
                type="button"
                title="Supprimer le dossier (son contenu remonte dans le dossier parent)"
                aria-label={`Supprimer le dossier « ${f.name} »`}
                onClick={() => {
                  if (confirm(`Supprimer le dossier « ${f.name} » ? Ses documents et sous-dossiers remonteront dans le dossier parent.`)) void run(() => api.delete<Resp>(`/folders/${f.id}`));
                }}
                className="rounded-lg p-2 text-faint hover:bg-red-50 hover:text-danger md:p-1.5"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Sélection multiple : déplacement groupé (alternative clavier / tactile au glisser-déposer) */}
      {selectedDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm" role="region" aria-label="Documents sélectionnés">
          <span className="font-medium text-brand-700">
            {selectedDocs.length} document{selectedDocs.length > 1 ? "s" : ""} sélectionné{selectedDocs.length > 1 ? "s" : ""}
          </span>
          <select
            value=""
            onChange={(e) => {
              const target = e.target.value;
              if (target === "") return;
              void moveDocs(
                selectedDocs.map((d) => d.id),
                target === ROOT ? null : target,
              );
            }}
            className={`${selectClassXs} max-w-56`}
            aria-label="Déplacer la sélection vers…"
          >
            <option value="">Déplacer vers…</option>
            {currentId !== null && <option value={ROOT}>🏠 Racine du projet</option>}
            {targetOptions(currentId ? new Set([currentId]) : undefined)}
          </select>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface hover:text-ink">
            <X className="h-3.5 w-3.5" /> Désélectionner
          </button>
        </div>
      )}

      {/* Documents du dossier courant (glissables) */}
      {docs.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted">
          <FolderOpen className="h-4 w-4" /> {subfolders.length ? "Aucun document directement dans ce dossier." : "Dossier vide."}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {docs.map((doc) => {
            const isSelected = selected.has(doc.id);
            return (
              <li
                key={doc.id}
                draggable
                onDragStart={(e) => {
                  const ids = isSelected ? selectedDocs.map((d) => d.id) : [doc.id];
                  startDrag(e, { kind: "docs", ids });
                }}
                onDragEnd={endDrag}
                onClick={(e) => onRowClick(e, doc.id)}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isSelected ? "bg-brand-50" : ""}`}
              >
                <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-faint sm:block" aria-hidden />
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(doc.id)}
                  className="h-4 w-4 shrink-0 accent-brand-600"
                  aria-label={`Sélectionner « ${doc.name} »`}
                />
                <FileText className="h-5 w-5 shrink-0 text-muted" />
                {/* Le nom garde au moins ~12rem : sur mobile, les listes passent à la ligne. */}
                <div className="min-w-[9rem] flex-[1_1_12rem]">
                  <InlineEdit value={doc.name} onSave={(name) => run(() => api.patch<Resp>(`/documents/${doc.id}`, { name }))} className="-mx-1.5 block truncate text-sm font-medium" />
                  <div className="truncate text-xs text-muted">
                    {doc.originalName} · {formatBytes(doc.size)} · {formatDate(doc.createdAt)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy.name}` : ""}
                  </div>
                </div>
                <select
                  value={doc.folderId ?? ROOT}
                  onChange={(e) => void moveDocs([doc.id], e.target.value === ROOT ? null : e.target.value)}
                  className={`${selectClassXs} min-w-0 flex-1 sm:max-w-44 sm:flex-none`}
                  title="Déplacer vers…"
                  aria-label={`Dossier de « ${doc.name} »`}
                >
                  <option value={ROOT}>🏠 Racine du projet</option>
                  {targetOptions()}
                </select>
                <select
                  value={doc.deliverableId ?? ""}
                  onChange={(e) => void run(() => api.patch<Resp>(`/documents/${doc.id}`, { deliverableId: e.target.value || null }))}
                  className={`${selectClassXs} min-w-0 flex-1 sm:max-w-48 sm:flex-none`}
                  title="Livrable matérialisé par ce document"
                  aria-label={`Livrable matérialisé par « ${doc.name} »`}
                >
                  <option value="">— Pas un livrable —</option>
                  {project.deliverables.map((d) => (
                    <option key={d.id} value={d.id}>
                      📦 {deliverableName.get(d.id)}
                    </option>
                  ))}
                </select>
                <a href={doc.url} draggable={false} title="Télécharger" aria-label={`Télécharger « ${doc.name} »`} className="rounded-lg p-2 text-muted hover:bg-surface-2 md:p-1.5">
                  <Download className="h-4 w-4" />
                </a>
                {(doc.uploadedBy?.id === currentUserId || project.ownerId === currentUserId) && (
                  <button
                    type="button"
                    title="Supprimer"
                    aria-label={`Supprimer « ${doc.name} »`}
                    onClick={() => {
                      if (confirm(`Supprimer définitivement « ${doc.name} » ?`)) void run(() => api.delete<Resp>(`/documents/${doc.id}`));
                    }}
                    className="rounded-lg p-2 text-faint hover:bg-red-50 hover:text-danger md:p-1.5"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
