import { useMemo, useSyncExternalStore } from "react";
import { back, getLocation, navigate, refresh, subscribe } from "./router";

/**
 * Remplacement de `next/navigation` dans l'application native : mêmes
 * signatures que ce qu'utilisent les composants du site (useRouter,
 * usePathname, useSearchParams, notFound, redirect).
 */

export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string, opts?: { scroll?: boolean }) => navigate(href, { scroll: opts?.scroll }),
      replace: (href: string, opts?: { scroll?: boolean }) => navigate(href, { replace: true, scroll: opts?.scroll }),
      refresh: () => refresh(),
      back: () => back(),
      forward: () => window.history.forward(),
      prefetch: () => {},
    }),
    [],
  );
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => getLocation().pathname, () => "/");
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => getLocation().search, () => "");
  return useMemo(() => new URLSearchParams(search), [search]);
}

export class NotFoundError extends Error {
  constructor() {
    super("NOT_FOUND");
  }
}

export function notFound(): never {
  throw new NotFoundError();
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error("REDIRECT");
}
