"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, History, Info, Loader2, Move, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { MapAt } from "@/lib/time-travel";
import { errorMessage, formatDate, inputClass } from "@/components/ui";

/**
 * Voyage dans le temps d'une carte mentale : arborescence telle qu'elle
 * était à la date choisie (titres, statuts, couleurs rembobinés depuis la
 * piste d'audit), nœuds supprimés et déplacés depuis. Lecture seule, en ligne.
 */

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

type Node = MapAt["nodes"][number];

export function MapTimeTravel({ mapId, title }: { mapId: string; title: string }) {
  const today = useMemo(() => ymd(new Date()), []);
  const [created, setCreated] = useState<string | null>(null);
  const [date, setDate] = useState(() => ymd(new Date(Date.now() - 7 * DAY_MS)));
  const [state, setState] = useState<MapAt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ state: MapAt }>(`/mindmaps/${mapId}/time-travel?at=${date}`)
        .then((r) => {
          if (!alive) return;
          setState(r.state);
          setCreated(ymd(new Date(r.state.createdAt)));
          setError(null);
        })
        .catch((e) => alive && setError(errorMessage(e, "Disponible uniquement en ligne.")))
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mapId, date]);

  const children = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of state?.nodes ?? []) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
    return m;
  }, [state]);
  const root = children.get(null)?.[0] ?? null;
  const first = created ?? date;
  const span = Math.max(1, Math.round((new Date(today).getTime() - new Date(first).getTime()) / DAY_MS));
  const offset = Math.round((new Date(date).getTime() - new Date(first).getTime()) / DAY_MS);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link href={`/mindmaps/${mapId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Retour à la carte
      </Link>
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <History className="h-6 w-6 text-brand-600" /> {title} — voyage dans le temps
      </h1>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          La carte telle qu&apos;elle était, reconstituée depuis son historique : titres, statuts et couleurs d&apos;alors. Les nœuds supprimés depuis ne sont
          connus que par leur titre ; un nœud déplacé est montré à sa place actuelle.
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="map-tt-date" className="text-sm font-medium">
          Au
        </label>
        <input id="map-tt-date" type="date" min={created ?? undefined} max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputClass} w-44`} />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>
      {created && (
        <input
          type="range"
          min={0}
          max={span}
          value={Math.max(0, Math.min(span, offset))}
          onChange={(e) => setDate(ymd(new Date(new Date(first).getTime() + Number(e.target.value) * DAY_MS)))}
          className="mt-3 w-full accent-brand-600"
          aria-label="Date consultée"
        />
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

      {state && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">
              {state.nodes.length} nœud{state.nodes.length > 1 ? "s" : ""} au {formatDate(date)} · {state.createdSince} ajouté{state.createdSince > 1 ? "s" : ""} depuis
            </p>
            {root ? (
              <ul className="mt-2">
                <Branch node={root} childrenOf={children} depth={0} />
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">La carte n&apos;existait pas encore à cette date.</p>
            )}
          </section>
          <aside className="space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Trash2 className="h-4 w-4 text-danger" /> Supprimés depuis
              </h2>
              {state.deletedSince.length === 0 ? (
                <p className="mt-1 text-xs text-muted">Aucun.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {state.deletedSince.map((d) => (
                    <li key={d.id + d.at} className="flex justify-between gap-2">
                      <span className="truncate line-through decoration-faint">{d.title}</span>
                      <span className="shrink-0 text-xs text-muted">{formatDate(d.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Move className="h-4 w-4 text-brand-600" /> Déplacés depuis
              </h2>
              {state.movedSince.length === 0 ? (
                <p className="mt-1 text-xs text-muted">Aucun.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {state.movedSince.map((m) => (
                    <li key={m.id} className="truncate">
                      {m.title}
                      {m.from && <span className="text-xs text-muted"> (était sous « {m.from} »)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function Branch({ node, childrenOf, depth }: { node: Node; childrenOf: Map<string | null, Node[]>; depth: number }) {
  const kids = childrenOf.get(node.id) ?? [];
  return (
    <li>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 18 }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: node.color ?? "var(--color-line-strong)" }} aria-hidden />
        <span className={`truncate text-sm ${depth === 0 ? "font-semibold" : ""} ${node.status === "CLOSED" ? "text-muted line-through" : ""}`}>{node.title}</span>
        {node.status === "WATCH" && <Eye className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="À surveiller" />}
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Branch key={k.id} node={k} childrenOf={childrenOf} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
