"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";

/**
 * Compteur des messages non lus (badge « Messages » du menu) : un seul
 * rafraîchissement partagé, toutes les 30 s, au retour de focus et à la
 * demande (après lecture d'une conversation).
 */

let count = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit(n: number) {
  if (n === count) return;
  count = n;
  for (const l of listeners) l();
}

export function refreshUnreadMessages(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .get<{ count: number }>("/messages/unread")
    .then((r) => emit(r.count))
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useUnreadMessages(): number {
  useEffect(() => {
    // Minuterie unique pour toute la durée de la page (plusieurs badges peuvent s'abonner).
    if (timer) return;
    void refreshUnreadMessages();
    timer = setInterval(() => void refreshUnreadMessages(), 30_000);
    window.addEventListener("focus", () => void refreshUnreadMessages());
  }, []);
  return useSyncExternalStore(subscribe, () => count, () => 0);
}
