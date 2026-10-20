"use client";

import { useRef } from "react";
import { Download, Eye, FileText, Paperclip, X } from "lucide-react";
import type { AttachmentDto } from "@/lib/attachments";
import { fileTypeLabel } from "@/lib/shared/file-types";
import { formatBytes } from "@/components/ui";

/**
 * Pièces jointes (commentaires de tâche, nœuds de carte) : liste compacte —
 * nom, type, taille, aperçu (images, PDF, HTML : `?inline=1`, servi en
 * « sandbox » sans script), téléchargement, retrait — et bouton « Joindre »
 * (sélection multiple). Téléversement et téléchargement en ligne uniquement.
 */

/** Types pour lesquels un aperçu dans le navigateur a du sens. */
const PREVIEWABLE = /^(image\/|application\/pdf$|text\/(plain|html|csv|markdown)$)/;

/** Types acceptés (mêmes que les documents de projet). */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown,text/html,.html,.htm,application/json,application/zip,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp";

export function AttachmentList({ items, canDelete, onDelete, compact = false }: { items: AttachmentDto[]; canDelete?: (a: AttachmentDto) => boolean; onDelete?: (a: AttachmentDto) => void; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${compact ? "" : "mt-2"}`} aria-label="Pièces jointes">
      {items.map((a) => (
        <li key={a.id} className="group inline-flex max-w-full items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <a href={a.url} className="min-w-0 truncate font-medium text-ink-2 hover:text-brand-700 hover:underline" title={`${a.fileName} — ${fileTypeLabel(a.mimeType, a.fileName)} · ${formatBytes(a.size)}${a.uploadedByName ? ` · ${a.uploadedByName}` : ""}`}>
            {a.fileName}
          </a>
          <span className="shrink-0 text-faint">{formatBytes(a.size)}</span>
          {PREVIEWABLE.test(a.mimeType) && (
            <a href={`${a.url}?inline=1`} target="_blank" rel="noopener" className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-ink" title="Aperçu" aria-label={`Aperçu de « ${a.fileName} »`}>
              <Eye className="h-3.5 w-3.5" />
            </a>
          )}
          <a href={a.url} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-ink" title="Télécharger" aria-label={`Télécharger « ${a.fileName} »`}>
            <Download className="h-3.5 w-3.5" />
          </a>
          {onDelete && (!canDelete || canDelete(a)) && (
            <button type="button" onClick={() => onDelete(a)} className="rounded p-0.5 text-faint hover:bg-red-50 hover:text-danger" title="Retirer" aria-label={`Retirer « ${a.fileName} »`}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Bouton « Joindre » (sélection multiple). */
export function AttachButton({ onFiles, disabled, label = "Joindre" }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
        title="Joindre des fichiers (PDF, Office, images, HTML… 25 Mo max chacun)"
      >
        <Paperclip className="h-4 w-4" /> {label}
      </button>
    </>
  );
}

/** Fichiers en attente (composer de commentaire) : puces retirables. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Fichiers à joindre">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-dashed border-line-strong px-2 py-1 text-xs text-ink-2">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 truncate">{f.name}</span>
          <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} className="rounded p-0.5 text-faint hover:text-danger" aria-label={`Ne pas joindre « ${f.name} »`}>
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
