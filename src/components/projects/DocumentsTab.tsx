"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Download, FileText, Folder, FolderOpen, FolderPlus, Home, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/client";
import type { FolderDto, ProjectDto } from "@/lib/projects";
import { Button, InlineEdit, QuickAdd, formatBytes, formatDate, selectClassXs } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/**
 * Explorateur documentaire du projet : arborescence de dossiers (fil d'Ariane,
 * sous-dossiers, documents du dossier courant), dépôt dans le dossier courant,
 * déplacement de documents et de dossiers, rattachement à un livrable.
 */

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

export function DocumentsTab({ project, run, currentUserId }: { project: ProjectDto; run: Run; currentUserId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);

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
  const deliverableName = new Map(project.deliverables.map((d) => [d.id, d.name]));
  const countIn = (folderId: string) => {
    const ids = subtree(folders, folderId);
    return project.documents.filter((d) => d.folderId && ids.has(d.folderId)).length;
  };
  const allFolderOptions = useMemo(
    () => folders.map((f) => ({ id: f.id, label: folderPath(folders, f.id) })).sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [folders],
  );

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

  return (
    <div className="space-y-4">
      {/* Fil d'Ariane + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
          <button onClick={() => setCurrent(null)} className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 ${currentId ? "text-muted hover:bg-surface-2 hover:text-ink" : "bg-surface-2 font-medium"}`}>
            <Home className="h-4 w-4" /> Documents
          </button>
          {breadcrumb.map((f, i) => (
            <span key={f.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 text-faint" />
              <button
                onClick={() => setCurrent(f.id)}
                className={`rounded-lg px-2 py-1 ${i === breadcrumb.length - 1 ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
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

      {/* Zone de dépôt */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-3 text-center text-xs transition-colors ${dragging ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line-strong text-muted"}`}
      >
        <span className="sm:hidden">Touchez « Téléverser ici » pour ajouter des fichiers dans « {currentId ? folderPath(folders, currentId) : "Racine"} » (25 Mo max)</span>
        <span className="hidden sm:inline">Glissez des fichiers ici pour les déposer dans « {currentId ? folderPath(folders, currentId) : "Racine"} » (PDF, Office, images, zip… 25 Mo max)</span>
      </div>

      {/* Sous-dossiers */}
      {subfolders.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((f) => (
            <li key={f.id} className="group flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
              {/* Ouvrir (icône, compteur) et renommer (titre) sont des contrôles distincts. */}
              <button type="button" onClick={() => setCurrent(f.id)} className="shrink-0 rounded-lg p-1.5 hover:bg-surface-2" title="Ouvrir le dossier" aria-label={`Ouvrir le dossier « ${f.name} »`}>
                <Folder className="h-5 w-5 text-warn" />
              </button>
              <div className="min-w-0 flex-1">
                <InlineEdit value={f.name} onSave={(name) => run(() => api.patch<Resp>(`/folders/${f.id}`, { name }))} className="-mx-1.5 block truncate text-sm font-medium" />
                <button type="button" onClick={() => setCurrent(f.id)} className="block text-left text-xs text-muted hover:text-ink hover:underline">
                  {countIn(f.id)} document{countIn(f.id) > 1 ? "s" : ""} · ouvrir
                </button>
              </div>
              <select
                value=""
                onChange={(e) => {
                  const target = e.target.value;
                  if (target === "") return;
                  void run(() => api.patch<Resp>(`/folders/${f.id}`, { parentId: target === "__root__" ? null : target }));
                }}
                className={`${selectClassXs} max-w-36`}
                title="Déplacer le dossier vers…"
                aria-label={`Déplacer le dossier « ${f.name} » vers…`}
              >
                <option value="">Déplacer vers…</option>
                {f.parentId !== null && <option value="__root__">Racine</option>}
                {allFolderOptions
                  .filter((o) => !subtree(folders, f.id).has(o.id) && o.id !== f.parentId)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
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

      {/* Documents du dossier courant */}
      {docs.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted">
          <FolderOpen className="h-4 w-4" /> {subfolders.length ? "Aucun document directement dans ce dossier." : "Dossier vide."}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="h-5 w-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <InlineEdit value={doc.name} onSave={(name) => run(() => api.patch<Resp>(`/documents/${doc.id}`, { name }))} className="-mx-1.5 block truncate text-sm font-medium" />
                <div className="truncate text-xs text-muted">
                  {doc.originalName} · {formatBytes(doc.size)} · {formatDate(doc.createdAt)}
                  {doc.uploadedBy ? ` · ${doc.uploadedBy.name}` : ""}
                </div>
              </div>
              <select
                value={doc.folderId ?? "__root__"}
                onChange={(e) => void run(() => api.patch<Resp>(`/documents/${doc.id}`, { folderId: e.target.value === "__root__" ? null : e.target.value }))}
                className={`${selectClassXs} max-w-44`}
                title="Dossier"
                aria-label={`Dossier de « ${doc.name} »`}
              >
                <option value="__root__">📁 Racine</option>
                {allFolderOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    📁 {o.label}
                  </option>
                ))}
              </select>
              <select
                value={doc.deliverableId ?? ""}
                onChange={(e) => void run(() => api.patch<Resp>(`/documents/${doc.id}`, { deliverableId: e.target.value || null }))}
                className={`${selectClassXs} max-w-48`}
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
              <a href={doc.url} title="Télécharger" aria-label={`Télécharger « ${doc.name} »`} className="rounded-lg p-2 text-muted hover:bg-surface-2 md:p-1.5">
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
          ))}
        </ul>
      )}
    </div>
  );
}
