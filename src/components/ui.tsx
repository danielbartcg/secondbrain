"use client";

import { useEffect, useRef, useState } from "react";

/** Petits composants d'interface partagés. */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50";
  const sizes = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const variants = {
    primary: "bg-brand-600 text-on-brand hover:bg-brand-700",
    outline: "border border-line-strong bg-surface text-ink-2 hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2",
    danger: "text-danger hover:bg-red-50",
  }[variant];
  return <button type="button" className={`${base} ${sizes} ${variants} ${className}`} {...props} />;
}

export function ProgressBar({ percent, color, className = "" }: { percent: number; color?: string | null; className?: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-surface-3 ${className}`} role="progressbar" aria-valuenow={pct}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color ?? (pct >= 100 ? "var(--color-ok)" : "var(--color-brand-500)") }}
      />
    </div>
  );
}

/** Texte éditable au clic (Entrée valide, Échap annule, blur valide). */
export function InlineEdit({
  value,
  onSave,
  className = "",
  inputClassName = "",
  placeholder = "Sans titre",
  as: Tag = "span",
  multiline = false,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  as?: "span" | "h1" | "h2" | "h3" | "h4" | "div";
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  }

  if (editing) {
    const common = {
      ref,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !(multiline && e.shiftKey)) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      },
      className: `w-full rounded border border-brand-500 bg-surface px-1.5 py-0.5 outline-none ring-2 ring-brand-100 ${inputClassName}`,
    };
    return multiline ? <textarea rows={3} {...common} /> : <input {...common} />;
  }

  return (
    <Tag
      onClick={() => setEditing(true)}
      title="Cliquer pour modifier"
      className={`cursor-text rounded px-1.5 py-0.5 hover:bg-surface-2 ${!value ? "text-faint" : ""} ${className}`}
    >
      {value || placeholder}
    </Tag>
  );
}

/** Formulaire d'ajout en une ligne (Entrée pour valider). */
export function QuickAdd({
  placeholder,
  onAdd,
  className = "",
  autoFocus = false,
}: {
  placeholder: string;
  onAdd: (value: string) => Promise<void> | void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onAdd(v);
      setValue("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={`flex gap-2 ${className}`}>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      <Button type="submit" size="sm" disabled={busy || !value.trim()}>
        Ajouter
      </Button>
    </form>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function toInputDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export const MEMBER_PALETTE = ["#4f5ff0", "#1f9d55", "#d98a0b", "#d13b3b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b"];

/** Couleur stable dérivée d'un identifiant (membre sans couleur choisie). */
export function colorFor(id: string, explicit?: string | null): string {
  if (explicit) return explicit;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MEMBER_PALETTE[h % MEMBER_PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Pastille d'initiales d'un membre. */
export function Avatar({ name, color, id, size = 28, className = "", title }: { name: string; color?: string | null; id: string; size?: number; className?: string; title?: string }) {
  return (
    <span
      title={title ?? name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), backgroundColor: colorFor(id, color) }}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: React.ReactNode; tone?: "neutral" | "brand" | "ok" | "warn" | "danger" | "violet"; className?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-ink-2",
    brand: "bg-brand-50 text-brand-700",
    ok: "bg-green-50 text-green-700",
    warn: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones} ${className}`}>{children}</span>;
}

export const selectClass = "rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
export const inputClass = "rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function relativeDays(days: number): string {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "demain";
  if (days === -1) return "hier";
  if (days < 0) return `il y a ${-days} j`;
  return `dans ${days} j`;
}

export const TASK_STATUS_LABEL = { TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CLOSED: "Clôturée" } as const;
export const TASK_STATUS_TONE = { TODO: "neutral", IN_PROGRESS: "brand", DONE: "ok", CLOSED: "violet" } as const;
export const DELIVERABLE_STATUS_LABEL = { PLANNED: "Prévu", IN_PROGRESS: "En cours", DELIVERED: "Livré", VALIDATED: "Validé" } as const;
export const DELIVERABLE_STATUS_TONE = { PLANNED: "neutral", IN_PROGRESS: "brand", DELIVERED: "warn", VALIDATED: "ok" } as const;
export const DELIVERABLE_STATUS_COLOR = { PLANNED: "#94a3b8", IN_PROGRESS: "#4f5ff0", DELIVERED: "#d98a0b", VALIDATED: "#1f9d55" } as const;
export const TASK_STATUS_COLOR = { TODO: "#94a3b8", IN_PROGRESS: "#4f5ff0", DONE: "#1f9d55", CLOSED: "#6b5fa8" } as const;
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CLOSED"] as const;
/** Terminée ou clôturée : sort du flux des tâches ouvertes. */
export const isFinished = (s: string) => s === "DONE" || s === "CLOSED";
