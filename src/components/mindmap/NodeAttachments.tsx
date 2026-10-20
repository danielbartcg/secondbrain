"use client";

import { useEffect, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { api } from "@/lib/client";
import type { AttachmentDto } from "@/lib/attachments";
import { AttachButton, AttachmentList } from "@/components/Attachments";
import { errorMessage, toast } from "@/components/ui";

/**
 * Pièces jointes d'un nœud de carte (panneau de l'éditeur) : liste,
 * « Joindre » (sélection multiple, glisser-déposer de fichiers sur le bloc)
 * et retrait si la carte est modifiable. En ligne uniquement.
 */
export function NodeAttachments({ mapId, nodeId, readOnly }: { mapId: string; nodeId: string; readOnly: boolean }) {
  const [items, setItems] = useState<AttachmentDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const base = `/mindmaps/${mapId}/nodes/${nodeId}/attachments`;

  useEffect(() => {
    let alive = true;
    setItems(null);
    api
      .get<{ attachments: AttachmentDto[] }>(base)
      .then((r) => alive && setItems(r.attachments))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [base]);

  async function upload(files: File[]) {
    setBusy(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        try {
          setItems((await api.post<{ attachments: AttachmentDto[] }>(base, form)).attachments);
        } catch (e) {
          toast(`« ${file.name} » : ${errorMessage(e, "envoi impossible (en ligne uniquement)")}`, "error");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: AttachmentDto) {
    if (!confirm(`Retirer la pièce jointe « ${a.fileName} » ?`)) return;
    try {
      setItems((await api.delete<{ attachments: AttachmentDto[] }>(`/attachments/${a.id}`)).attachments);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (readOnly && items && items.length === 0) return null;
  return (
    <div
      className={`mt-4 rounded-lg ${over ? "ring-2 ring-brand-500" : ""}`}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (readOnly || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5 text-muted" aria-hidden />
        <span className="text-xs font-medium text-muted">Pièces jointes{items?.length ? ` (${items.length})` : ""}</span>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
        {!readOnly && (
          <div className="ml-auto">
            <AttachButton onFiles={(f) => void upload(f)} disabled={busy} />
          </div>
        )}
      </div>
      {items === null ? null : items.length === 0 ? (
        <p className="text-xs text-faint">Aucune pièce jointe — glissez des fichiers ici ou « Joindre ».</p>
      ) : (
        <AttachmentList items={items} compact onDelete={readOnly ? undefined : (a) => void remove(a)} />
      )}
    </div>
  );
}
