import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiClientError } from "@/lib/client";
import { getRefreshTick, subscribe } from "../shims/router";

/**
 * Chargement des données d'un écran via `api` (servi par l'API locale).
 * Rechargé quand les dépendances changent ou à chaque `router.refresh()`.
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: ApiClientError | Error | null; loading: boolean } {
  const tick = useSyncExternalStore(subscribe, getRefreshTick, () => 0);
  const [state, setState] = useState<{ data: T | null; error: ApiClientError | Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return state;
}
