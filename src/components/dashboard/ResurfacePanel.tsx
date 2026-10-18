"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, BookOpenCheck, ExternalLink, Repeat, Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import type { ResurfaceItem } from "@/lib/resurface";
import { errorMessage, toast } from "@/components/ui";

/**
 * Tableau de bord — « À relire aujourd'hui » : la résurgence fait remonter
 * chaque jour quelques notes anciennes (répétition espacée, boîtes de
 * Leitner). Masqué hors ligne ou quand il n'y a rien à relire.
 */

const KIND_LABEL: Record<string, string> = { task: "Tâche", project: "Projet", stage: "Étape", activity: "Activité", mindmap: "Carte", node: "Nœud" };

export function ResurfacePanel() {
  const [items, setItems] = useState<ResurfaceItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<{ items: ResurfaceItem[] }>("/me/resurface")
      .then((r) => alive && setItems(r.items))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function answer(ref: string, a: "remember" | "again" | "archive") {
    setBusy(ref);
    try {
      const r = await api.post<{ items: ResurfaceItem[] }>("/me/resurface", { ref, answer: a });
      setItems(r.items);
      setDone((n) => n + 1);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (items === null || (items.length === 0 && done === 0)) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Sparkles className="h-5 w-5 text-violet-600" /> À relire aujourd&apos;hui
      </h2>
      <p className="mt-0.5 text-xs text-muted">Quelques notes anciennes reviennent chaque jour ; plus elles vous servent, plus elles reviennent tard.</p>
      {items.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-2">
          <BookOpenCheck className="h-4 w-4 text-ok" /> C&apos;est tout pour aujourd&apos;hui. À demain !
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((it) => (
            <li key={it.ref} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    {KIND_LABEL[it.kind] ?? it.kind}
                    {it.box > 0 ? ` · boîte ${it.box}` : " · première relecture"}
                  </p>
                  <Link href={`/notes?ref=${encodeURIComponent(it.ref)}`} className="block truncate text-sm font-semibold hover:text-brand-700">
                    {it.title}
                  </Link>
                  {it.context && <p className="truncate text-xs text-muted">{it.context}</p>}
                </div>
                {it.href && (
                  <Link href={it.href} className="shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" title="Ouvrir l'objet" aria-label={`Ouvrir « ${it.title} »`}>
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
              </div>
              <p className="mt-2 line-clamp-4 text-sm text-ink-2">{it.excerpt}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy === it.ref}
                  onClick={() => void answer(it.ref, "remember")}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-700 disabled:opacity-50 md:py-1"
                >
                  <BookOpenCheck className="h-3.5 w-3.5" /> Toujours utile
                </button>
                <button
                  type="button"
                  disabled={busy === it.ref}
                  onClick={() => void answer(it.ref, "again")}
                  className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50 md:py-1"
                >
                  <Repeat className="h-3.5 w-3.5" /> À revoir bientôt
                </button>
                <button
                  type="button"
                  disabled={busy === it.ref}
                  onClick={() => void answer(it.ref, "archive")}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 disabled:opacity-50 md:py-1"
                >
                  <Archive className="h-3.5 w-3.5" /> Ne plus proposer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
