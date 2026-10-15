"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { MindMapDto, MindMapSummary } from "@/lib/mindmaps";
import { Button, EmptyState, InlineEdit, PageHeader, errorMessage, formatDate } from "@/components/ui";
import { PinButton } from "@/components/PinButton";

export function MindMapList({ initial }: { initial: MindMapSummary[] }) {
  const router = useRouter();
  const [maps, setMaps] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const t = title.trim() || "Nouvelle carte";
    setBusy(true);
    setError(null);
    try {
      const { mindmap } = await api.post<{ mindmap: MindMapDto }>("/mindmaps", { title: t });
      router.push(`/mindmaps/${mindmap.id}`);
    } catch (err) {
      setError(errorMessage(err, "Création impossible."));
      setBusy(false);
    }
  }

  async function rename(id: string, t: string) {
    const previous = maps;
    setError(null);
    setMaps((ms) => ms.map((m) => (m.id === id ? { ...m, title: t } : m)));
    try {
      await api.patch(`/mindmaps/${id}`, { title: t });
    } catch (err) {
      setMaps(previous);
      setError(errorMessage(err, "Renommage impossible."));
    }
  }

  async function remove(id: string, t: string) {
    if (!confirm(`Supprimer la carte « ${t} » et tous ses nœuds ?`)) return;
    const previous = maps;
    setError(null);
    setMaps((ms) => ms.filter((m) => m.id !== id));
    try {
      await api.delete(`/mindmaps/${id}`);
    } catch (err) {
      setMaps(previous);
      setError(errorMessage(err, "Suppression impossible."));
    }
  }

  return (
    <>
      <PageHeader
        title="Cartes mentales"
        subtitle="Structurez vos idées, prenez des notes riches sur chaque nœud."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouvelle carte
          </Button>
        }
      />

      {creating && (
        <form onSubmit={create} className="mb-6 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de la carte (idée centrale)"
            aria-label="Titre de la carte"
            className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Création…" : "Créer"}
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      {maps.length === 0 ? (
        <EmptyState title="Aucune carte pour l'instant" hint="Une carte part d'une idée centrale et se ramifie.">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Créer une carte
          </Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((m) => (
            <li key={m.id} className="group relative rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-md">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Brain className="h-5 w-5" />
                </div>
                <PinButton kind="MINDMAP" item={{ id: m.id, name: m.title }} className="ml-auto" />
                <button
                  type="button"
                  onClick={() => remove(m.id, m.title)}
                  title="Supprimer"
                  aria-label={`Supprimer la carte « ${m.title} »`}
                  className="rounded-lg p-2 md:p-1.5 text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-danger group-hover:opacity-100 focus:opacity-100 max-md:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <InlineEdit value={m.title} onSave={(t) => rename(m.id, t)} as="h2" className="-mx-1.5 block font-semibold leading-snug" />
              <p className="mt-1 text-xs text-muted">
                {m.nodeCount} nœud{m.nodeCount > 1 ? "s" : ""} · modifiée le {formatDate(m.updatedAt)}
              </p>
              <Link href={`/mindmaps/${m.id}`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                Ouvrir →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
