"use client";

import { createElement, useEffect, useState } from "react";

/**
 * Données des icônes Lucide (nom → éléments SVG), générées par
 * `npm run icons:build` dans un seul module JSON chargé à la demande (≈ 90 Ko
 * compressés, mis en cache) : aucun module par icône, compilation légère.
 */

type Node = [string, Record<string, string | number>];
export type IconData = Record<string, Node[]>;

let cache: IconData | null = null;
let pending: Promise<IconData> | null = null;
const listeners = new Set<(d: IconData) => void>();

export function loadIconData(): Promise<IconData> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("@/lib/generated/lucide-icons.json").then((m) => {
    const mod = m as unknown as { default?: IconData };
    cache = mod.default ?? (m as unknown as IconData);
    for (const l of listeners) l(cache);
    return cache;
  });
  return pending;
}

/** Données des icônes (null tant qu'elles se chargent). */
export function useIconData(): IconData | null {
  const [data, setData] = useState<IconData | null>(cache);
  useEffect(() => {
    if (cache) return setData(cache);
    listeners.add(setData);
    void loadIconData();
    return () => {
      listeners.delete(setData);
    };
  }, []);
  return data;
}

/** Icône Lucide dessinée depuis ses éléments (mêmes attributs que lucide-react). */
export function LucideSvg({ nodes, className }: { nodes: Node[]; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
