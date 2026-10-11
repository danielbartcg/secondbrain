"use client";

import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import { Button, InlineEdit, formatBytes, formatDate, selectClass } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/** Documents du projet : dépôt (glisser-déposer ou sélection), rattachement à un livrable, téléchargement. */
export function DocumentsTab({ project, run, currentUserId }: { project: ProjectDto; run: Run; currentUserId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const deliverableName = new Map(project.deliverables.map((d) => [d.id, d.name]));

  async function upload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await run(() => api.post<Resp>(`/projects/${project.id}/documents`, form));
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
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
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm transition-colors ${
          dragging ? "border-brand-500 bg-brand-50" : "border-line-strong bg-surface"
        }`}
      >
        <Upload className="h-6 w-6 text-muted" />
        <p className="text-muted">Glissez vos fichiers ici (PDF, Office, images, zip… 25 Mo max)</p>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4" /> {uploading ? "Envoi…" : "Choisir des fichiers"}
        </Button>
      </div>

      {project.documents.length === 0 ? (
        <p className="text-center text-sm text-muted">Aucun document pour l&apos;instant.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {project.documents.map((doc) => (
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
                value={doc.deliverableId ?? ""}
                onChange={(e) => void run(() => api.patch<Resp>(`/documents/${doc.id}`, { deliverableId: e.target.value || null }))}
                className={`${selectClass} max-w-52 text-xs`}
                title="Livrable matérialisé par ce document"
              >
                <option value="">— Pas un livrable —</option>
                {project.deliverables.map((d) => (
                  <option key={d.id} value={d.id}>
                    📦 {deliverableName.get(d.id)}
                  </option>
                ))}
              </select>
              <a href={doc.url} title="Télécharger" className="rounded-lg p-1.5 text-muted hover:bg-surface-2">
                <Download className="h-4 w-4" />
              </a>
              {(doc.uploadedBy?.id === currentUserId || project.ownerId === currentUserId) && (
                <button
                  title="Supprimer"
                  onClick={() => {
                    if (confirm(`Supprimer définitivement « ${doc.name} » ?`)) void run(() => api.delete<Resp>(`/documents/${doc.id}`));
                  }}
                  className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger"
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
