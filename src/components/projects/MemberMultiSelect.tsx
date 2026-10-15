"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import type { MemberDto } from "@/lib/projects";
import { Avatar, selectClass } from "@/components/ui";

/** Sélection multiple de membres (cases à cocher), pour les contributeurs. */
export function MemberMultiSelect({ members, value, disabled, onChange }: { members: MemberDto[]; value: string[]; disabled?: boolean; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = members.filter((m) => value.includes(m.id));
  // Fermeture au clic extérieur et sur Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (disabled) return <p className="text-xs text-muted">Rattachez la tâche à un projet pour choisir des contributeurs.</p>;
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${selectClass} flex w-full items-center gap-1 text-left`} aria-expanded={open} aria-label="Contributeurs">
        {selected.length === 0 ? (
          <span className="text-muted">— Personne —</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selected.map((m) => (
              <span key={m.id} className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs">
                <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={18} /> {m.name}
              </span>
            ))}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{selected.length}/{members.length}</span>
      </button>
      {open && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {members.map((m) => {
            const checked = value.includes(m.id);
            return (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((id) => id !== m.id) : [...value, m.id])} className="accent-brand-600" />
                  <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.role && <span className="text-xs text-muted">{m.role}</span>}
                </label>
              </li>
            );
          })}
          <li className="border-t border-line p-1 text-right">
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">
              Fermer
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
