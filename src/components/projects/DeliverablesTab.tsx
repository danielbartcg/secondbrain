"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, Package, Paperclip, Plus, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/client";
import type { DeliverableDto, ProjectDto } from "@/lib/projects";
import { Avatar, Badge, Button, DELIVERABLE_STATUS_LABEL, DELIVERABLE_STATUS_TONE, InlineEdit, QuickAdd, formatBytes, formatDate, selectClass, toInputDate } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/** Livrables du projet : statut, responsable, dates attendues, documents rattachés. */
export function DeliverablesTab({ project, run }: { project: ProjectDto; run: Run }) {
  const [adding, setAdding] = useState(project.deliverables.length === 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Package className="h-5 w-5 text-brand-600" /> Livrables
        </h2>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4" /> Livrable
        </Button>
      </div>
      {adding && (
        <QuickAdd
          autoFocus
          placeholder="Nom du livrable (ex. Cahier des charges, Maquettes, Rapport final…)"
          onAdd={async (name) => {
            await run(() => api.post<Resp>(`/projects/${project.id}/deliverables`, { name }));
          }}
        />
      )}
      {project.deliverables.length === 0 && !adding && (
        <p className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">Aucun livrable : déclarez ce que le projet doit produire.</p>
      )}
      {project.deliverables.map((d, i) => (
        <DeliverableCard key={d.id} d={d} index={i} count={project.deliverables.length} project={project} run={run} />
      ))}
    </div>
  );
}

function DeliverableCard({ d, index, count, project, run }: { d: DeliverableDto; index: number; count: number; project: ProjectDto; run: Run }) {
  const patch = (data: Record<string, unknown>) => run(() => api.patch<Resp>(`/deliverables/${d.id}`, data));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const assignee = d.assigneeId ? project.members.find((m) => m.id === d.assigneeId) : null;
  const late = d.expectedEnd && (d.status === "PLANNED" || d.status === "IN_PROGRESS") && new Date(d.expectedEnd) < new Date();
  const unattached = project.documents.filter((doc) => !doc.deliverableId);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("deliverableId", d.id);
        await run(() => api.post<Resp>(`/projects/${project.id}/documents`, form));
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={DELIVERABLE_STATUS_TONE[d.status]}>{DELIVERABLE_STATUS_LABEL[d.status]}</Badge>
            <InlineEdit value={d.name} onSave={(name) => patch({ name })} as="h3" className="-mx-1.5 font-semibold" />
            {late && <Badge tone="danger">En retard</Badge>}
          </div>
          <InlineEdit
            value={d.description}
            onSave={(description) => patch({ description })}
            as="div"
            multiline
            placeholder="Description du livrable…"
            className="-mx-1.5 mt-1 block whitespace-pre-wrap text-sm text-ink-2"
          />
        </div>
        <div className="flex items-center">
          <button title="Monter" disabled={index === 0} onClick={() => patch({ order: index - 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button title="Descendre" disabled={index === count - 1} onClick={() => patch({ order: index + 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            title="Supprimer le livrable"
            onClick={() => {
              if (confirm(`Supprimer le livrable « ${d.name} » ? Les documents rattachés restent dans le projet.`)) void run(() => api.delete<Resp>(`/deliverables/${d.id}`));
            }}
            className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Statut
          <select value={d.status} onChange={(e) => patch({ status: e.target.value })} className={selectClass}>
            {Object.entries(DELIVERABLE_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Responsable
          <select value={d.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} className={selectClass}>
            <option value="">— Personne —</option>
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Étape
          <select value={d.stageId ?? ""} onChange={(e) => patch({ stageId: e.target.value || null })} className={selectClass}>
            <option value="">— Aucune —</option>
            {project.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Début attendu
          <input type="date" value={toInputDate(d.expectedStart)} onChange={(e) => patch({ expectedStart: e.target.value || null })} className={selectClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Fin attendue
          <input type="date" value={toInputDate(d.expectedEnd)} onChange={(e) => patch({ expectedEnd: e.target.value || null })} className={selectClass} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        {assignee && (
          <span className="flex items-center gap-1.5">
            <Avatar id={assignee.id} name={assignee.name} color={assignee.color} src={assignee.avatarUrl} size={20} /> {assignee.name}
          </span>
        )}
        {d.deliveredAt && <span>Livré le {formatDate(d.deliveredAt)}</span>}
      </div>

      {/* Documents du livrable */}
      <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Paperclip className="h-3.5 w-3.5" /> Documents ({d.documents.length})
          </span>
          <div className="ml-auto flex items-center gap-2">
            {unattached.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void run(() => api.patch<Resp>(`/documents/${e.target.value}`, { deliverableId: d.id }));
                  e.target.value = "";
                }}
                className={`${selectClass} max-w-48 text-xs`}
                title="Rattacher un document existant du projet"
              >
                <option value="">Rattacher un document…</option>
                {unattached.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}
                  </option>
                ))}
              </select>
            )}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" /> {uploading ? "Envoi…" : "Téléverser"}
            </Button>
          </div>
        </div>
        {d.documents.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {d.documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 py-1.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted" />
                <a href={doc.url} className="min-w-0 flex-1 truncate font-medium hover:text-brand-700 hover:underline" title={doc.originalName}>
                  {doc.name}
                </a>
                <span className="hidden text-xs text-muted sm:inline">{formatBytes(doc.size)}</span>
                <a href={doc.url} title="Télécharger" className="rounded-lg p-1.5 text-muted hover:bg-surface-3">
                  <Download className="h-4 w-4" />
                </a>
                <button title="Détacher du livrable" onClick={() => void run(() => api.patch<Resp>(`/documents/${doc.id}`, { deliverableId: null }))} className="rounded-lg p-1.5 text-faint hover:bg-surface-3 hover:text-ink">
                  <Paperclip className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
