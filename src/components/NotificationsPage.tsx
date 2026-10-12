"use client";

import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { NotificationItem } from "@/components/NotificationsBell";
import { markAllNotificationsRead, useNotifications } from "@/lib/notifications-store";

/** Page complète des notifications : filtre toutes / non lues, actions par ligne. */
export function NotificationsPage() {
  const { items, unreadCount, loaded } = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Notifications"
        subtitle="Tâches assignées, réponses à vos commentaires, mises à jour de vos tâches, mentions."
        actions={
          <Button variant="outline" size="sm" onClick={() => void markAllNotificationsRead()} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4" /> Tout marquer comme lu
          </Button>
        }
      />
      <div className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1 text-sm w-fit">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${filter === f ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {f === "all" ? "Toutes" : `Non lues (${unreadCount})`}
          </button>
        ))}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted">
            <Bell className="h-8 w-8 text-faint" />
            {loaded ? (filter === "unread" ? "Aucune notification non lue." : "Aucune notification pour le moment.") : "Chargement…"}
          </div>
        ) : (
          shown.map((n) => <NotificationItem key={n.id} n={n} />)
        )}
      </div>
    </div>
  );
}
