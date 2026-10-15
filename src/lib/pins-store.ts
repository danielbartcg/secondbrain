"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import type { PinsDto } from "@/lib/pins";

/**
 * Épingles du menu (projets, cartes) partagées entre le menu de gauche et les
 * boutons « Épingler ». Valeur initiale fournie par le serveur (coque web) ;
 * sinon chargée à la première utilisation (application desktop).
 */

const EMPTY: PinsDto = { projects: [], mindmaps: [] };
let state: PinsDto = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: PinsDto) {
  state = next;
  loaded = true;
  for (const l of listeners) l();
}

/** Valeur fournie par le rendu serveur (à appeler avant le premier rendu client). */
export function seedPins(initial: PinsDto | undefined) {
  if (initial && !loaded) {
    state = initial;
    loaded = true;
  }
}

export async function refreshPins(): Promise<void> {
  try {
    emit((await api.get<{ pins: PinsDto }>("/me/pins")).pins);
  } catch {
    /* hors ligne : on garde l'état courant */
  }
}

export function isPinned(kind: "PROJECT" | "MINDMAP", id: string): boolean {
  return (kind === "PROJECT" ? state.projects : state.mindmaps).some((x) => x.id === id);
}

/** Épingle / désépingle (optimiste, annulé en cas d'échec). */
export async function togglePin(kind: "PROJECT" | "MINDMAP", item: { id: string; name: string; color?: string | null }): Promise<void> {
  const before = state;
  const pinned = !isPinned(kind, item.id);
  emit(
    kind === "PROJECT"
      ? { ...state, projects: pinned ? [...state.projects, { id: item.id, name: item.name, color: item.color ?? null }] : state.projects.filter((p) => p.id !== item.id) }
      : { ...state, mindmaps: pinned ? [...state.mindmaps, { id: item.id, title: item.name }] : state.mindmaps.filter((m) => m.id !== item.id) },
  );
  try {
    emit((await api.put<{ pins: PinsDto }>("/me/pins", { kind, id: item.id, pinned })).pins);
  } catch (e) {
    emit(before);
    throw e;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePins(): PinsDto {
  useEffect(() => {
    if (!loaded) void refreshPins();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}
