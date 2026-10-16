"use client";

import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { api } from "@/lib/client";
import type { MapEventDto } from "@/lib/map-events";
import { Avatar } from "@/components/ui";

/**
 * Historique d'une carte mentale (piste d'audit) : panneau latéral (tiroir bas
 * sur mobile), la modification la plus récente d'abord, regroupée par jour.
 * Portée : toute la carte ou le nœud sélectionné ; filtres par nature.
 * Un clic sur une entrée sélectionne le nœud concerné s'il existe encore.
 */

const FILTERS = [
  { key: "all", label: "Tout" },
  { key: "nodes", label: "Nœuds" },
  { key: "notes", label: "Notes" },
  { key: "tasks", label: "Tâches" },
  { key: "sharing", label: "Carte et partages" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

function matches(e: MapEventDto, f: Filter) {
  if (f === "all") return true;
  if (f === "notes") return e.kind === "node_notes";
  if (f === "tasks") return e.kind === "task_linked" || e.kind === "task_unlinked";
  if (f === "sharing") return ["created", "renamed", "shared", "share_changed", "unshared", "left", "layout_reset"].includes(e.kind);
  return e.kind.startsWith("node_") && e.kind !== "node_notes";
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function MapHistoryPanel({
  mapId,
  version,
  selectedNode,
  nodeExists,
  onSelectNode,
  onClose,
}: {
  mapId: string;
  /** Change à chaque modification de la carte : rechargement. */
  version: string;
  selectedNode: { id: string; title: string } | null;
  nodeExists: (id: string) => boolean;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"map" | "node">(selectedNode ? "node" : "map");
  const [filter, setFilter] = useState<Filter>("all");
  const [events, setEvents] = useState<MapEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nodeId = scope === "node" && selectedNode ? selectedNode.id : null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<{ events: MapEventDto[] }>(`/mindmaps/${mapId}/history${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ""}`)
      .then((r) => !cancelled && setEvents(r.events))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Historique indisponible."));
    return () => {
      cancelled = true;
    };
  }, [mapId, nodeId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = (events ?? []).filter((e) => matches(e, filter));

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[75dvh] flex-col rounded-t-2xl border border-line bg-surface shadow-xl md:inset-x-auto md:bottom-4 md:right-4 md:top-20 md:max-h-none md:w-96 md:rounded-2xl"
      aria-label="Historique de la carte"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <History className="h-4 w-4 text-brand-600" />
        <h2 className="flex-1 text-sm font-semibold">Historique</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink" title="Fermer" aria-label="Fermer l'historique">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="space-y-2 border-b border-line px-4 py-2">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5 text-xs" role="radiogroup" aria-label="Portée">
          <button type="button" role="radio" aria-checked={scope === "map"} onClick={() => setScope("map")} className={`flex-1 rounded-md px-2 py-1 font-medium ${scope === "map" ? "bg-surface shadow-sm" : "text-muted"}`}>
            Toute la carte
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === "node"}
            disabled={!selectedNode}
            onClick={() => setScope("node")}
            className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 font-medium disabled:opacity-40 ${scope === "node" ? "bg-surface shadow-sm" : "text-muted"}`}
            title={selectedNode ? `Nœud « ${selectedNode.title} »` : "Sélectionnez un nœud"}
          >
            {selectedNode ? `Nœud « ${selectedNode.title} »` : "Nœud sélectionné"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filtrer l'historique">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f.key ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {events === null && !error && <p className="mt-3 text-sm text-muted">Chargement…</p>}
        {events && visible.length === 0 && <p className="mt-3 text-sm text-muted">Aucune modification enregistrée.</p>}
        <ol>
          {visible.map((e, i) => {
            const newDay = i === 0 || new Date(visible[i - 1].createdAt).toDateString() !== new Date(e.createdAt).toDateString();
            const target = e.nodeId && nodeExists(e.nodeId) ? e.nodeId : null;
            return (
              <li key={e.id}>
                {newDay && <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{dayLabel(e.createdAt)}</div>}
                <div
                  className={`flex items-start gap-2 rounded-lg px-1 py-1.5 ${target ? "cursor-pointer hover:bg-surface-2" : ""}`}
                  onClick={target ? () => onSelectNode(target) : undefined}
                  title={target ? "Afficher le nœud" : undefined}
                >
                  <Avatar id={e.actorId ?? e.id} name={e.actorName} src={e.actorAvatarUrl} size={22} className="mt-0.5" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="break-words text-ink-2">{e.message}</p>
                    <time className="text-[11px] text-faint" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
