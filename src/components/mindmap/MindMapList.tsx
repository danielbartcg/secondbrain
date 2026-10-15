"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, LogOut, Plus, Share2, Trash2, Users } from "lucide-react";
import { api } from "@/lib/client";
import type { MindMapDto, MindMapSummary } from "@/lib/mindmaps";
import { Avatar, Badge, Button, EmptyState, InlineEdit, PageHeader, errorMessage, formatDate } from "@/components/ui";
import { PinButton } from "@/components/PinButton";

type Filter = "all" | "mine" | "shared";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Toutes" },
  { id: "mine", label: "Les miennes" },
  { id: "shared", label: "Partagées avec moi" },
];

/**
 * Liste des cartes : les miennes et celles qu'on m'a partagées (icône de
 * partage, « Partagée par … », droit Lecture / Écriture). Supprimer : mes
 * cartes seulement ; une carte partagée se « quitte ».
 */
export function MindMapList({ initial }: { initial: MindMapSummary[] }) {
  const router = useRouter();
  const [maps, setMaps] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
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

  async function leave(m: MindMapSummary) {
    if (!confirm(`Quitter la carte « ${m.title} » partagée par ${m.owner?.name ?? "son propriétaire"} ? Vous n'y aurez plus accès.`)) return;
    const previous = maps;
    setError(null);
    setMaps((ms) => ms.filter((x) => x.id !== m.id));
    try {
      const { user } = await api.get<{ user: { id: string } }>("/auth/me");
      await api.delete(`/mindmaps/${m.id}/shares/${user.id}`);
    } catch (err) {
      setMaps(previous);
      setError(errorMessage(err, "Impossible de quitter la carte."));
    }
  }

  const sharedCount = maps.filter((m) => m.access !== "owner").length;
  const visible = maps.filter((m) => (filter === "all" ? true : filter === "mine" ? m.access === "owner" : m.access !== "owner"));

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

      {sharedCount > 0 && (
        <div role="tablist" aria-label="Filtrer les cartes" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${filter === f.id ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
            >
              {f.label}
              {f.id === "shared" && <span className="ml-1 opacity-80">({sharedCount})</span>}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && maps.length > 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          {filter === "shared" ? "Aucune carte ne vous a été partagée." : "Aucune carte à vous pour l'instant."}
        </p>
      ) : maps.length === 0 ? (
        <EmptyState title="Aucune carte pour l'instant" hint="Une carte part d'une idée centrale et se ramifie.">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Créer une carte
          </Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => (
            <li key={m.id} className="group relative rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-md">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Brain className="h-5 w-5" />
                  {m.owner && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white ring-2 ring-[var(--color-surface)]" title={`Partagée par ${m.owner.name}`} aria-label={`Partagée par ${m.owner.name}`}>
                      <Users className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <PinButton kind="MINDMAP" item={{ id: m.id, name: m.title }} className="ml-auto" />
                {m.access === "owner" ? (
                  <button
                    type="button"
                    onClick={() => remove(m.id, m.title)}
                    title="Supprimer"
                    aria-label={`Supprimer la carte « ${m.title} »`}
                    className="rounded-lg p-2 md:p-1.5 text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-danger group-hover:opacity-100 focus:opacity-100 max-md:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => leave(m)}
                    title="Quitter la carte partagée"
                    aria-label={`Quitter la carte « ${m.title} »`}
                    className="rounded-lg p-2 md:p-1.5 text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-danger group-hover:opacity-100 focus:opacity-100 max-md:opacity-100"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
              </div>
              {m.access === "read" ? (
                <h2 className="block font-semibold leading-snug">{m.title}</h2>
              ) : (
                <InlineEdit value={m.title} onSave={(t) => rename(m.id, t)} as="h2" className="-mx-1.5 block font-semibold leading-snug" />
              )}
              <p className="mt-1 text-xs text-muted">
                {m.nodeCount} nœud{m.nodeCount > 1 ? "s" : ""} · modifiée le {formatDate(m.updatedAt)}
              </p>
              {m.owner ? (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Avatar id={m.owner.id} name={m.owner.name} src={m.owner.avatarUrl} size={18} />
                  <span className="min-w-0 truncate">Partagée par {m.owner.name}</span>
                  <Badge tone={m.access === "write" ? "brand" : "neutral"}>{m.access === "write" ? "Écriture" : "Lecture"}</Badge>
                </p>
              ) : m.sharedWith > 0 ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                  <Share2 className="h-3.5 w-3.5 text-brand-600" /> Partagée avec {m.sharedWith} personne{m.sharedWith > 1 ? "s" : ""}
                </p>
              ) : null}
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
