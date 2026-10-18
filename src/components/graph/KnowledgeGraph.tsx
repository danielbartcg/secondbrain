"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";
import type { KnowledgeGraph as GraphDto } from "@/lib/links";
import { LINK_KINDS, LINK_KIND_COLOR, LINK_KIND_LABEL, type LinkKind } from "@/lib/shared/links";
import { AmChart, applyBaseTheme, themeColor } from "@/components/charts/AmChart";
import { selectClass } from "@/components/ui";

/**
 * Graphe de connaissances : objets reliés par des liens `[[…]]` (notes des
 * projets, étapes, activités, tâches, nœuds de carte, comptes-rendus de
 * réunion). amCharts 4, extension « force-directed » chargée à la demande et
 * construite via l'enveloppe `AmChart`. Clic sur un objet = ouvrir sa page.
 * Filtre par projet ou par carte (objets du périmètre + leurs voisins).
 */

type ForceModule = typeof import("@/components/charts/forceDirected");

/** Libellés amCharts : `[` et `]` sont des codes de mise en forme. */
const amText = (s: string) => s.replace(/\[/g, "[[").replace(/\]/g, "]]");
const short = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function KnowledgeGraph({ graph, projects, maps }: { graph: GraphDto; projects: { id: string; name: string }[]; maps: { id: string; title: string }[] }) {
  const router = useRouter();
  const [fd, setFd] = useState<ForceModule | null>(null);
  const [scope, setScope] = useState("");
  const [hidden, setHidden] = useState<Set<LinkKind>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void import("@/components/charts/forceDirected").then((m) => alive && setFd(m));
    return () => {
      alive = false;
    };
  }, []);

  const view = useMemo(() => {
    const [kind, id] = scope ? scope.split(":") : ["", ""];
    const inScope = (n: GraphDto["nodes"][number]) => !kind || (kind === "project" ? n.projectId === id : n.mapId === id);
    const byRef = new Map(graph.nodes.map((n) => [n.ref, n]));
    const seeds = new Set(graph.nodes.filter(inScope).map((n) => n.ref));
    const edges = graph.edges.filter((e) => (seeds.has(e.from) || seeds.has(e.to)) && !hidden.has(byRef.get(e.from)!.kind) && !hidden.has(byRef.get(e.to)!.kind));
    const refs = new Set(edges.flatMap((e) => [e.from, e.to]));
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const nodes = [...refs].map((r) => ({ ...byRef.get(r)!, degree: degree.get(r) ?? 0 }));
    return { nodes, edges };
  }, [graph, scope, hidden]);

  const top = useMemo(() => [...view.nodes].sort((a, b) => b.degree - a.degree).slice(0, 12), [view.nodes]);
  const counts = useMemo(() => {
    const m = new Map<LinkKind, number>();
    for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
    return m;
  }, [graph.nodes]);

  const toggleKind = (k: LinkKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Network className="h-6 w-6 text-brand-600" /> Graphe des liens
      </h1>
      <p className="mt-1 text-sm text-muted">
        Les objets reliés entre eux par des liens <kbd className="rounded border border-line px-1 font-mono text-xs">[[</kbd> tapés dans vos notes et comptes-rendus.
        Cliquez sur un objet pour l&apos;ouvrir.
      </p>

      {graph.nodes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center">
          <p className="font-medium">Aucun lien pour l&apos;instant.</p>
          <p className="mt-1 text-sm text-muted">
            Dans une note (tâche, projet, nœud de carte…), tapez <kbd className="rounded border border-line px-1 font-mono text-xs">[[</kbd> puis le nom d&apos;un objet pour le lier.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label htmlFor="graph-scope" className="text-sm font-medium text-ink-2">
              Périmètre
            </label>
            <select id="graph-scope" value={scope} onChange={(e) => setScope(e.target.value)} className={`${selectClass} max-w-[18rem]`}>
              <option value="">Tout</option>
              {projects.length > 0 && (
                <optgroup label="Projets">
                  {projects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {maps.length > 0 && (
                <optgroup label="Cartes mentales">
                  {maps.map((m) => (
                    <option key={m.id} value={`map:${m.id}`}>
                      {m.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <ul className="flex flex-wrap gap-1.5" aria-label="Types d'objets affichés">
              {LINK_KINDS.filter((k) => counts.has(k)).map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    aria-pressed={!hidden.has(k)}
                    onClick={() => toggleKind(k)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${hidden.has(k) ? "border-line text-faint line-through" : "border-line-strong text-ink-2"}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LINK_KIND_COLOR[k], opacity: hidden.has(k) ? 0.3 : 1 }} aria-hidden />
                    {LINK_KIND_LABEL[k]} ({counts.get(k)})
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {graph.truncated && <p className="mt-2 text-xs text-warn">Beaucoup de notes contiennent des liens : seule une partie est affichée.</p>}

          <div className="mt-4 rounded-2xl border border-line bg-surface p-2">
            {fd ? (
              <AmChart
                height={560}
                deps={[fd, view]}
                empty={view.nodes.length === 0 ? "Aucun lien dans ce périmètre" : null}
                build={(am4core, _charts, container) => {
                  const chart = am4core.create(container, fd.ForceDirectedTree);
                  applyBaseTheme(am4core, chart);
                  const links = new Map<string, string[]>();
                  for (const e of view.edges) links.set(e.from, [...(links.get(e.from) ?? []), e.to]);
                  chart.data = view.nodes.map((n) => ({
                    id: n.ref,
                    name: amText(short(n.title)),
                    full: amText(n.title),
                    kind: LINK_KIND_LABEL[n.kind],
                    href: n.href,
                    value: 1 + n.degree,
                    color: am4core.color(LINK_KIND_COLOR[n.kind]),
                    linkWith: links.get(n.ref) ?? [],
                  }));
                  const series = chart.series.push(new fd.ForceDirectedSeries());
                  series.dataFields.id = "id";
                  series.dataFields.name = "name";
                  series.dataFields.value = "value";
                  series.dataFields.color = "color";
                  series.dataFields.linkWith = "linkWith";
                  series.minRadius = 10;
                  series.maxRadius = 34;
                  series.manyBodyStrength = -18;
                  series.links.template.strength = 0.6;
                  series.links.template.strokeWidth = 1.5;
                  series.links.template.stroke = am4core.color(themeColor("--color-line-strong", "#c9c9d1"));
                  series.links.template.strokeOpacity = 0.9;
                  series.nodes.template.label.text = "{name}";
                  series.nodes.template.label.fill = am4core.color(themeColor("--color-ink", "#17171a"));
                  series.nodes.template.label.fontSize = 11;
                  series.nodes.template.label.valign = "bottom";
                  series.nodes.template.label.dy = 8;
                  series.nodes.template.label.hideOversized = false;
                  series.nodes.template.label.truncate = false;
                  series.nodes.template.tooltipText = "[bold]{full}[/]\n{kind}";
                  series.nodes.template.togglable = false;
                  series.nodes.template.cursorOverStyle = am4core.MouseCursorStyle.pointer;
                  series.nodes.template.outerCircle.strokeOpacity = 0;
                  series.nodes.template.events.on("hit", (ev) => {
                    const d = ev.target.dataItem?.dataContext as { href?: string } | undefined;
                    if (d?.href) router.push(d.href);
                  });
                  return chart;
                }}
              />
            ) : (
              <div className="flex h-[560px] items-center justify-center text-sm text-muted">Chargement du graphe…</div>
            )}
          </div>

          {top.length > 0 && (
            <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold">Les plus reliés</h2>
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {top.map((n) => (
                  <li key={n.ref}>
                    <Link href={n.href} className="flex items-center gap-2 py-1 text-sm hover:text-brand-700">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LINK_KIND_COLOR[n.kind] }} aria-hidden />
                      <span className="min-w-0 truncate">{n.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">
                        {n.degree} lien{n.degree > 1 ? "s" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
