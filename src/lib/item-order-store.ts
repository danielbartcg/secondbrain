"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { refreshPins } from "@/lib/pins-store";

/**
 * Ordre personnel des projets et des cartes (listes + épingles du menu),
 * partagé entre écrans. Valeur initiale fournie par la page (rendu serveur),
 * sinon chargée à la première utilisation (application : dernière valeur
 * connue hors ligne). Jamais d'état de module au rendu serveur.
 */

export type OrderKind = "PROJECT" | "MINDMAP";
const EMPTY: string[] = [];
const state: Record<OrderKind, string[]> = { PROJECT: EMPTY, MINDMAP: EMPTY };
const loaded: Record<OrderKind, boolean> = { PROJECT: false, MINDMAP: false };
const listeners = new Set<() => void>();

function emit(kind: OrderKind, ids: string[]) {
  state[kind] = ids;
  loaded[kind] = true;
  for (const l of listeners) l();
}

export function seedItemOrder(kind: OrderKind, ids: string[] | undefined) {
  if (typeof window === "undefined" || !ids || loaded[kind]) return;
  state[kind] = ids;
  loaded[kind] = true;
}

export async function refreshItemOrder(kind: OrderKind): Promise<void> {
  try {
    emit(kind, (await api.get<{ ids: string[] }>(`/me/order?kind=${kind}`)).ids);
  } catch {
    /* hors ligne : ordre courant conservé */
  }
}

/** Nouvel ordre (optimiste, annulé en cas d'échec) ; les épingles du menu suivent. */
export async function saveItemOrder(kind: OrderKind, ids: string[]): Promise<void> {
  const before = state[kind];
  emit(kind, ids);
  try {
    emit(kind, (await api.put<{ ids: string[] }>("/me/order", { kind, ids })).ids);
    void refreshPins();
  } catch (e) {
    emit(kind, before);
    throw e;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useItemOrder(kind: OrderKind, initial?: string[]): string[] {
  useEffect(() => {
    if (!loaded[kind]) void refreshItemOrder(kind);
  }, [kind]);
  return useSyncExternalStore(subscribe, () => state[kind], () => initial ?? EMPTY);
}

/**
 * Trie selon l'ordre personnel : éléments rangés d'abord (rang croissant),
 * puis les autres du plus récemment modifié au plus ancien.
 */
export function sortByOrder<T extends { id: string; updatedAt: string }>(items: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || b.updatedAt.localeCompare(a.updatedAt));
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
/** Identifiants triés A → Z (libellé) ou par mise à jour (plus récente d'abord). */
export function sortedIds<T extends { id: string; updatedAt: string }>(items: T[], by: "alpha" | "updated", label: (x: T) => string): string[] {
  const list = [...items];
  if (by === "alpha") list.sort((a, b) => collator.compare(label(a), label(b)));
  else list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list.map((x) => x.id);
}
