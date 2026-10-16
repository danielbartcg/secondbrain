"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, GripVertical, List, Loader2, Plus, SlidersHorizontal, Trash2, Type, X } from "lucide-react";
import { api } from "@/lib/client";
import { CUSTOM_FIELD_TYPE_LABEL, type CustomFieldDto, type CustomFieldTypeValue } from "@/lib/shared/custom-fields";
import { Badge, Button, InlineEdit, errorMessage, inputClass, toast } from "@/components/ui";

/**
 * Administration → Champs personnalisés des projets (ex. « Client ») : texte
 * libre ou liste de valeurs gérée ici. Renommer une valeur la renomme dans
 * tous les projets ; supprimer une valeur ou un champ efface ces valeurs des
 * projets (confirmation). Archiver masque le champ des fiches projet en
 * conservant les valeurs.
 */
export function AdminCustomFields({ initial, usage: initialUsage }: { initial: CustomFieldDto[]; usage: Record<string, number> }) {
  const [fields, setFields] = useState(initial);
  const [usage, setUsage] = useState(initialUsage);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldTypeValue>("LIST");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ fields: CustomFieldDto[] }>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      setFields(r.fields);
      const u = await api.get<{ usage: Record<string, number> }>("/admin/custom-fields").catch(() => null);
      if (u) setUsage(u.usage);
      if (ok) toast(ok, "ok");
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    if (await run(() => api.post("/admin/custom-fields", { label: label.trim(), type }), `Champ « ${label.trim()} » créé.`)) setLabel("");
  }

  const patch = (f: CustomFieldDto, body: Record<string, unknown>, ok?: string) => run(() => api.patch(`/admin/custom-fields/${f.id}`, body), ok);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Champs personnalisés des projets</h2>
            <p className="text-sm text-muted">
              Informations communes à tous les projets (ex. « Client », « Programme », « Code analytique ») : texte libre ou liste de valeurs que vous gérez ici.
              Elles se renseignent dans chaque projet (bloc « Informations ») et figurent dans l&apos;export Excel et le connecteur Claude.
            </p>
          </div>
        </div>
        <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted">
            Libellé
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Ex. Client" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as CustomFieldTypeValue)} className={`${inputClass} py-2`}>
              <option value="LIST">Liste de valeurs</option>
              <option value="TEXT">Texte libre</option>
            </select>
          </label>
          <Button type="submit" disabled={busy || !label.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter le champ
          </Button>
        </form>
      </section>

      {fields.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-muted">Aucun champ personnalisé pour l&apos;instant.</p>}

      {fields.map((f, i) => (
        <FieldCard
          key={f.id}
          field={f}
          index={i}
          count={fields.length}
          used={usage[f.id] ?? 0}
          busy={busy}
          onPatch={(body, ok) => patch(f, body, ok)}
          onDelete={() => {
            const used = usage[f.id] ?? 0;
            if (!window.confirm(`Supprimer définitivement le champ « ${f.label} » ?${used ? `\n\nSa valeur sera effacée de ${used} projet${used > 1 ? "s" : ""}. Pour la conserver, archivez plutôt le champ.` : ""}`)) return;
            void run(() => api.delete(`/admin/custom-fields/${f.id}`), `Champ « ${f.label} » supprimé.`);
          }}
        />
      ))}
    </div>
  );
}

function FieldCard({
  field: f,
  index,
  count,
  used,
  busy,
  onPatch,
  onDelete,
}: {
  field: CustomFieldDto;
  index: number;
  count: number;
  used: number;
  busy: boolean;
  onPatch: (body: Record<string, unknown>, ok?: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [newValue, setNewValue] = useState("");
  const options = f.options;
  const saveOptions = (next: { id?: string; label: string }[], ok?: string) => onPatch({ options: next }, ok);

  async function addValue(e: React.FormEvent) {
    e.preventDefault();
    const values = newValue
      .split(/\n|;/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (!values.length) return;
    if (await saveOptions([...options, ...values.map((label) => ({ label }))], values.length > 1 ? `${values.length} valeurs ajoutées.` : undefined)) setNewValue("");
  }

  return (
    <section className={`rounded-2xl border border-line bg-surface ${f.active ? "" : "opacity-70"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <GripVertical className="h-4 w-4 text-faint" aria-hidden />
        <span className="text-muted">{f.type === "LIST" ? <List className="h-4 w-4" /> : <Type className="h-4 w-4" />}</span>
        <InlineEdit value={f.label} onSave={(label) => void onPatch({ label: label.slice(0, 60) }, "Libellé modifié.")} className="-mx-1.5 min-w-0 flex-1 font-semibold" />
        <Badge tone="neutral">{CUSTOM_FIELD_TYPE_LABEL[f.type]}</Badge>
        {!f.active && <Badge tone="warn">Archivé</Badge>}
        <span className="text-xs text-muted">
          {used} projet{used > 1 ? "s" : ""} renseigné{used > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" disabled={busy || index === 0} onClick={() => void onPatch({ order: index - 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" title="Monter" aria-label="Monter">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={busy || index === count - 1} onClick={() => void onPatch({ order: index + 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" title="Descendre" aria-label="Descendre">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPatch({ active: !f.active }, f.active ? "Champ archivé : masqué des projets, valeurs conservées." : "Champ réactivé.")}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2"
            title={f.active ? "Archiver (masquer sans perdre les valeurs)" : "Réactiver"}
            aria-label={f.active ? "Archiver" : "Réactiver"}
          >
            {f.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </button>
          <button type="button" disabled={busy} onClick={onDelete} className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger" title="Supprimer" aria-label="Supprimer le champ">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>
      {f.type === "LIST" ? (
        <div className="px-4 py-3">
          {options.length === 0 && <p className="text-sm text-muted">Aucune valeur : ajoutez-en ci-dessous.</p>}
          <ul className="flex flex-wrap gap-1.5">
            {options.map((o, i) => (
              <li key={o.id} className="group inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-sm">
                <InlineEdit
                  value={o.label}
                  onSave={(label) => void saveOptions(options.map((x) => (x.id === o.id ? { id: x.id, label: label.slice(0, 100) } : x)), "Valeur renommée dans tous les projets.")}
                  className="-mx-1 min-w-0"
                />
                <button
                  type="button"
                  disabled={busy || i === 0}
                  onClick={() => {
                    const next = [...options];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    void saveOptions(next);
                  }}
                  className="hidden rounded-full p-0.5 text-faint hover:bg-surface-3 hover:text-ink group-hover:inline-flex disabled:opacity-30"
                  title="Avancer"
                  aria-label={`Avancer ${o.label}`}
                >
                  <ArrowUp className="h-3 w-3 -rotate-90" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (used && !window.confirm(`Retirer la valeur « ${o.label} » ? Elle sera effacée des projets qui l'utilisent.`)) return;
                    void saveOptions(options.filter((x) => x.id !== o.id));
                  }}
                  className="rounded-full p-0.5 text-faint hover:bg-red-50 hover:text-danger"
                  title="Retirer la valeur"
                  aria-label={`Retirer ${o.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addValue} className="mt-3 flex flex-wrap gap-2">
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Nouvelle valeur (plusieurs : séparées par « ; »)"
              maxLength={5000}
              className={`${inputClass} min-w-[14rem] flex-1 py-1.5`}
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !newValue.trim()}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </form>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">Texte libre, saisi dans chaque projet (500 caractères au plus).</p>
      )}
    </section>
  );
}
