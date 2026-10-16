"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { customEntries, customValueLabel, type CustomFieldDto } from "@/lib/shared/custom-fields";
import { inputClass } from "@/components/ui";

/**
 * Champs personnalisés des projets (définis dans l'administration) : bloc
 * « Informations » de la fiche projet et pastilles de la liste des projets.
 * Définitions chargées une fois par page (GET /custom-fields ; l'application
 * garde la dernière liste connue hors ligne).
 */

let cache: CustomFieldDto[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function load() {
  loading ??= api
    .get<{ fields: CustomFieldDto[] }>("/custom-fields")
    .then((r) => {
      cache = r.fields;
      for (const l of listeners) l();
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** Définitions actives (null tant qu'elles ne sont pas chargées). */
export function useCustomFields(): CustomFieldDto[] | null {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache,
    () => null,
  );
}

/** Bloc « Informations » : un contrôle par champ, enregistré à la sortie / au choix. */
export function ProjectCustomFields({ values, onChange, disabled = false }: { values: Record<string, string>; onChange: (patch: Record<string, string | null>) => void; disabled?: boolean }) {
  const fields = useCustomFields();
  if (!fields || fields.length === 0) return null;
  return (
    <div className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((f) => (
        <label key={f.id} className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          {f.label}
          {f.type === "LIST" ? (
            <select
              value={values[f.id] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ [f.id]: e.target.value || null })}
              className={`${inputClass} py-1.5 text-ink`}
            >
              <option value="">—</option>
              {/* Valeur retirée de la liste : affichée telle quelle. */}
              {values[f.id] && !f.options.some((o) => o.id === values[f.id]) && <option value={values[f.id]}>{customValueLabel(f, values[f.id])}</option>}
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <TextValue value={values[f.id] ?? ""} disabled={disabled} onSave={(v) => onChange({ [f.id]: v || null })} />
          )}
        </label>
      ))}
    </div>
  );
}

function TextValue({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <input
      value={draft}
      disabled={disabled}
      maxLength={500}
      placeholder="—"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${inputClass} py-1.5 text-ink`}
    />
  );
}

/** Pastilles « Libellé : valeur » (liste des projets). */
export function CustomFieldChips({ values, max = 3 }: { values: Record<string, string>; max?: number }) {
  const fields = useCustomFields();
  if (!fields) return null;
  const entries = customEntries(fields, values);
  if (!entries.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {entries.slice(0, max).map((e) => (
        <span key={e.id} className="max-w-full truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2" title={`${e.label} : ${e.value}`}>
          <span className="text-muted">{e.label} :</span> {e.value}
        </span>
      ))}
      {entries.length > max && <span className="text-[11px] text-muted">+{entries.length - max}</span>}
    </div>
  );
}
