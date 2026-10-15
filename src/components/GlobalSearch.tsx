"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, FolderKanban, ListTodo, Loader2, Search, Workflow, X } from "lucide-react";
import { api } from "@/lib/client";
import type { SearchHit, SearchKind } from "@/lib/search";

/**
 * Moteur de recherche de la page d'accueil, avec auto-complétion : projets,
 * tâches, nœuds de carte mentale et cartes (titre / nom et description /
 * notes). Résultats groupés, navigation clavier, pleine largeur sur mobile.
 * Cliquer un résultat ouvre la page dédiée.
 */

const KIND_LABEL: Record<SearchKind, string> = { project: "Projets", task: "Tâches", node: "Nœuds de carte", mindmap: "Cartes mentales" };
const KIND_ORDER: SearchKind[] = ["task", "project", "node", "mindmap"];
const KIND_ICON = { project: FolderKanban, task: ListTodo, node: Workflow, mindmap: Brain } as const;

export function GlobalSearch({ autoFocus = false, className = "" }: { autoFocus?: boolean; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Recherche différée (250 ms) ; les réponses périmées sont ignorées.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { results } = await api.get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(query)}`);
        if (id === seq.current) {
          setHits(results);
          setFailed(false);
          setActive(0);
        }
      } catch {
        if (id === seq.current) {
          setHits([]);
          setFailed(true);
        }
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /** Liste ordonnée (groupée par type) pour la navigation clavier. */
  const ordered = useMemo(() => KIND_ORDER.flatMap((k) => hits.filter((h) => h.kind === k)), [hits]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQ("");
    router.push(hit.href);
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 sm:px-4 sm:py-2.5">
        {loading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted" /> : <Search className="h-5 w-5 shrink-0 text-muted" />}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showPanel || ordered.length === 0) {
              if (e.key === "Escape") setQ("");
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % ordered.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + ordered.length) % ordered.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(ordered[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Rechercher une tâche, un projet, une idée…"
          aria-label="Rechercher"
          aria-expanded={showPanel}
          role="combobox"
          aria-controls="global-search-results"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="rounded-full p-1.5 text-muted hover:bg-surface-2"
            aria-label="Effacer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showPanel && (
        <div id="global-search-results" role="listbox" className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[60dvh] overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl">
          {ordered.length === 0 ? (
            <p className={`px-4 py-6 text-center text-sm ${failed && !loading ? "text-danger" : "text-muted"}`}>
              {loading ? "Recherche…" : failed ? "Recherche indisponible pour le moment. Réessayez dans un instant." : `Aucun résultat pour « ${q.trim()} »`}
            </p>
          ) : (
            KIND_ORDER.map((kind) => {
              const group = hits.filter((h) => h.kind === kind);
              if (group.length === 0) return null;
              const Icon = KIND_ICON[kind];
              return (
                <div key={kind} className="border-b border-line last:border-b-0">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[kind]}</div>
                  <ul>
                    {group.map((h) => {
                      const idx = ordered.indexOf(h);
                      return (
                        <li key={`${h.kind}-${h.id}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={idx === active}
                            onMouseEnter={() => setActive(idx)}
                            onClick={() => go(h)}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left ${idx === active ? "bg-brand-50" : "hover:bg-surface-2"}`}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-2" style={{ backgroundColor: h.color ? `${h.color}22` : "var(--color-surface-3)", color: h.color ?? undefined }}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                <Highlight text={h.title} q={q} />
                              </span>
                              {h.subtitle && (
                                <span className="block truncate text-xs text-muted">
                                  <Highlight text={h.subtitle} q={q} />
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          <div className="hidden px-3 py-1.5 text-[11px] text-faint sm:block">↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer</div>
        </div>
      )}
    </div>
  );
}

/** Surligne les occurrences de la recherche. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  let idx = lower.indexOf(needle);
  while (idx !== -1 && parts.length < 20) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={idx} className="rounded bg-amber-100 px-0.5 text-inherit">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    i = idx + needle.length;
    idx = lower.indexOf(needle, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}
