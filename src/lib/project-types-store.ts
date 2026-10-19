"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { EMPTY_PROJECT_TYPES, type ProjectTypesDto } from "@/lib/shared/project-types";

/**
 * Types de projet personnels partagés entre le menu (épingles groupées) et la
 * liste des projets. Valeur initiale fournie par le serveur (coque web) ;
 * sinon chargée à la première utilisation (application, dernière valeur
 * connue hors ligne). Les mutations remplacent l'état par la réponse.
 */

let state: ProjectTypesDto = EMPTY_PROJECT_TYPES;
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: ProjectTypesDto) {
  state = next;
  loaded = true;
  for (const l of listeners) l();
}

/** Jamais côté serveur : l'état du module y serait partagé entre requêtes (et utilisateurs). */
export function seedProjectTypes(initial: ProjectTypesDto | undefined) {
  if (typeof window === "undefined") return;
  if (initial && !loaded) {
    state = initial;
    loaded = true;
  }
}

export async function refreshProjectTypes(): Promise<void> {
  try {
    emit((await api.get<{ projectTypes: ProjectTypesDto }>("/me/project-types")).projectTypes);
  } catch {
    /* hors ligne : on garde l'état courant */
  }
}

export const getProjectTypes = () => state;

/** Applique une modification locale tout de suite, puis la réponse du serveur (retour arrière en cas d'échec). */
export async function mutateProjectTypes(optimistic: ProjectTypesDto | null, call: () => Promise<{ projectTypes: ProjectTypesDto }>): Promise<void> {
  const before = state;
  if (optimistic) emit(optimistic);
  try {
    emit((await call()).projectTypes);
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

/** `initial` : valeur de la requête, rendue côté serveur et à l'hydratation (jamais l'état du module). */
export function useProjectTypes(initial?: ProjectTypesDto): ProjectTypesDto {
  useEffect(() => {
    if (!loaded) void refreshProjectTypes();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => initial ?? EMPTY_PROJECT_TYPES);
}
