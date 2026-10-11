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
