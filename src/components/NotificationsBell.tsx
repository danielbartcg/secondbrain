"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Bell, ClipboardCheck, Share2, CheckCheck, Circle, MessageSquareReply, MessagesSquare, Pencil, Trash2, UserCheck } from "lucide-react";
import type { NotificationDto } from "@/lib/notifications";
import { markAllNotificationsRead, refreshNotifications, removeNotification, setRead, useNotifications } from "@/lib/notifications-store";

/**
 * Cloche de notifications (style réseau social) : compteur de non lues,
 * panneau déroulant des dernières notifications, chacune cliquable (marquée
 * lue et ouvre l'endroit concerné), bascule lue / non lue, « tout marquer lu ».
 */

const ICON = {
  ASSIGNED: { Icon: UserCheck, className: "bg-brand-50 text-brand-700" },
  REPLY: { Icon: MessageSquareReply, className: "bg-green-50 text-green-700" },
  TASK_UPDATED: { Icon: Pencil, className: "bg-amber-50 text-amber-700" },
  MENTION: { Icon: AtSign, className: "bg-violet-50 text-violet-700" },
  MESSAGE: { Icon: MessagesSquare, className: "bg-indigo-100 text-indigo-800" },
  MEETING_REVIEW: { Icon: ClipboardCheck, className: "bg-amber-50 text-amber-700" },
  MEETING_DECISION: { Icon: ClipboardCheck, className: "bg-green-50 text-green-700" },
  MAP_SHARED: { Icon: Share2, className: "bg-violet-50 text-violet-700" },
} as const;

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function NotificationItem({ n, onNavigate, compact = false }: { n: NotificationDto; onNavigate?: () => void; compact?: boolean }) {
  const router = useRouter();
  const { Icon, className } = ICON[n.type];
  const open = async () => {
    if (!n.read) void setRead(n.id, true);
    onNavigate?.();
    router.push(n.href);
  };
  return (
    <div className={`group relative flex gap-3 px-3 py-2.5 transition-colors ${n.read ? "hover:bg-surface-2" : "bg-brand-50/50 hover:bg-brand-50"}`}>
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${className}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm leading-snug ${n.read ? "text-ink-2" : "font-medium text-ink"}`}>{n.title}</span>
          {n.body && !compact && <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>}
          <span className={`mt-0.5 block text-[11px] ${n.read ? "text-faint" : "text-brand-700"}`}>{timeAgo(n.createdAt)}</span>
        </span>
        {!n.read && <Circle className="mt-2 h-2.5 w-2.5 shrink-0 fill-brand-600 text-brand-600" aria-label="Non lue" />}
      </button>
      <div className="hidden shrink-0 items-start gap-0.5 group-focus-within:flex [@media(hover:hover)]:absolute [@media(hover:hover)]:right-2 [@media(hover:hover)]:top-2 [@media(hover:hover)]:items-center [@media(hover:hover)]:rounded-lg [@media(hover:hover)]:border [@media(hover:hover)]:border-line [@media(hover:hover)]:bg-surface [@media(hover:hover)]:shadow-sm [@media(hover:hover)]:group-hover:flex [@media(hover:none)]:flex">
        <button
          type="button"
          onClick={() => void setRead(n.id, !n.read)}
          title={n.read ? "Marquer comme non lue" : "Marquer comme lue"}
          aria-label={n.read ? "Marquer comme non lue" : "Marquer comme lue"}
          className="rounded p-2 text-muted hover:bg-surface-2 hover:text-ink [@media(hover:hover)]:p-1"
        >
          {n.read ? <Circle className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => void removeNotification(n.id)} title="Supprimer" aria-label="Supprimer la notification" className="rounded p-2 text-muted hover:bg-red-50 hover:text-danger [@media(hover:hover)]:p-1">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NotificationsBell({ align = "left" }: { align?: "left" | "right" }) {
  const { items, unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refreshNotifications();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} non lue${unreadCount > 1 ? "s" : ""})` : ""}`}
        title="Notifications"
        className={`relative rounded-lg p-2 transition-colors hover:bg-surface-2 ${open ? "bg-surface-2 text-brand-700" : "text-ink-2"}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`fixed inset-x-2 top-14 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:mt-1 sm:w-96 ${align === "right" ? "sm:right-0" : "sm:left-0"}`}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            {unreadCount > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{unreadCount} non lue{unreadCount > 1 ? "s" : ""}</span>}
            <button
              type="button"
              onClick={() => void markAllNotificationsRead()}
              disabled={unreadCount === 0}
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40"
              title="Tout marquer comme lu"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Tout lu
            </button>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Aucune notification pour le moment.</p>
            ) : (
              items.map((n) => <NotificationItem key={n.id} n={n} onNavigate={() => setOpen(false)} compact />)
            )}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-surface-2">
            Voir toutes les notifications
          </Link>
        </div>
      )}
    </div>
  );
}
