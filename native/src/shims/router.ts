/**
 * Routeur minimal de l'application native (historique HTML5), utilisé par les
 * remplacements de `next/link` et `next/navigation`. Un seul état global :
 * l'emplacement courant et un compteur d'actualisation (`refresh()`).
 */

type Location = { pathname: string; search: string; hash: string };
type Listener = () => void;

let current: Location = read();
let refreshTick = 0;
const listeners = new Set<Listener>();

function read(): Location {
  if (typeof window === "undefined") return { pathname: "/", search: "", hash: "" };
  return { pathname: window.location.pathname || "/", search: window.location.search, hash: window.location.hash };
}

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    current = read();
    emit();
  });
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getLocation(): Location {
  return current;
}

export function getRefreshTick(): number {
  return refreshTick;
}

/** Résout un href relatif ou absolu (même origine) en chemin. */
function resolve(href: string): URL {
  return new URL(href, window.location.href);
}

export function navigate(href: string, opts: { replace?: boolean; scroll?: boolean } = {}) {
  const url = resolve(href);
  if (url.origin !== window.location.origin) {
    window.secondBrain ? void window.secondBrain.openExternal(url.href) : window.open(url.href, "_blank", "noopener");
    return;
  }
  const samePage = url.pathname === current.pathname && url.search === current.search;
  if (opts.replace) window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  else window.history.pushState(null, "", url.pathname + url.search + url.hash);
  current = read();
  emit();
  if (url.hash) {
    // Les ancres (#comment-…, #plan) sont lues par les écrans eux-mêmes.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  if (!samePage && opts.scroll !== false) window.scrollTo(0, 0);
}

/** Recharge les données de l'écran courant (équivalent de router.refresh()). */
export function refresh() {
  refreshTick++;
  emit();
}

export function back() {
  window.history.back();
}
