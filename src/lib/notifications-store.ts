"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import type { NotificationDto } from "@/lib/notifications";

/**
 * Petit magasin client des notifications, partagé entre la cloche de la barre
 * latérale et celle de l'en-tête mobile : un seul rafraîchissement périodique
 * (toutes les 60 s, au retour de focus et à l'ouverture du panneau).
 */

type State = { items: NotificationDto[]; unreadCount: number; loaded: boolean };
type Resp = { notifications: NotificationDto[]; unreadCount: number };

let state: State = { items: [], unreadCount: 0, loaded: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit(next: State) {
  state = next;
  for (const l of listeners) l();
}

export function refreshNotifications(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .get<Resp>("/notifications?limit=30")
    .then((r) => emit({ items: r.notifications, unreadCount: r.unreadCount, loaded: true }))
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function setRead(id: string, read: boolean): Promise<void> {
  const before = state;
  emit({
    ...state,
    items: state.items.map((n) => (n.id === id ? { ...n, read } : n)),
    unreadCount: Math.max(0, state.unreadCount + (read ? -1 : 1) * (before.items.find((n) => n.id === id)?.read === read ? 0 : 1)),
  });
  try {
    await api.patch(`/notifications/${id}`, { read });
  } catch {
    emit(before);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const before = state;
  emit({ ...state, items: state.items.map((n) => ({ ...n, read: true })), unreadCount: 0 });
  try {
    await api.post("/notifications/read-all");
  } catch {
    emit(before);
  }
}

export async function removeNotification(id: string): Promise<void> {
  const target = state.items.find((n) => n.id === id);
  emit({ ...state, items: state.items.filter((n) => n.id !== id), unreadCount: target && !target.read ? Math.max(0, state.unreadCount - 1) : state.unreadCount });
  await api.delete(`/notifications/${id}`).catch(() => refreshNotifications());
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    void refreshNotifications();
    timer = setInterval(() => void refreshNotifications(), 60_000);
    window.addEventListener("focus", refreshNotifications);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refreshNotifications);
    }
  };
}

const EMPTY: State = { items: [], unreadCount: 0, loaded: false };

export function useNotifications(): State {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    if (!state.loaded) void refreshNotifications();
  }, []);
  return snapshot;
}
