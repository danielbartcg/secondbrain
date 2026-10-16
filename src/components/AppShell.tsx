"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessagesSquare, Brain, CalendarCheck2, FolderKanban, LayoutDashboard, LogOut, Menu, NotebookPen, Settings, ShieldCheck, UsersRound, X } from "lucide-react";
import { Avatar } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client";
import { NotificationsBell } from "@/components/NotificationsBell";
import { useUnreadMessages } from "@/lib/messages-store";
import { seedPins, usePins } from "@/lib/pins-store";
import type { PinsDto } from "@/lib/pins";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/mindmaps", label: "Cartes mentales", icon: Brain },
  { href: "/projects", label: "Projets", icon: FolderKanban },
  { href: "/organize", label: "Mes tâches", icon: CalendarCheck2 },
  { href: "/notes", label: "Prise de notes", icon: NotebookPen },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
];

function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={`min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-on-brand ${className}`} aria-label={`${count} message${count > 1 ? "s" : ""} non lu${count > 1 ? "s" : ""}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export type ShellUser = { id: string; name: string; email: string; avatarUrl: string | null; isAdmin: boolean; reportCount: number };

/**
 * Coque applicative responsive : barre latérale fixe sur grand écran,
 * barre supérieure + tiroir sur mobile. Les pages « plein cadre » (éditeur
 * de carte) utilisent toute la hauteur restante.
 */
/**
 * `statusSlot` : encart facultatif affiché au-dessus du menu (l'application
 * native y place l'état de synchronisation). Absent sur le site.
 */
export function AppShell({ user, children, statusSlot, pins: initialPins }: { user: ShellUser; children: React.ReactNode; statusSlot?: React.ReactNode; pins?: PinsDto }) {
  seedPins(initialPins);
  const pins = usePins();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unreadMessages = useUnreadMessages();

  // Tiroir mobile : Échap le ferme.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // Application hors ligne : des modifications n'ont pas encore été envoyées au serveur.
      if (e instanceof ApiClientError && e.code === "UNSYNCED_CHANGES") {
        if (!window.confirm(`${e.message}\n\nReconnectez-vous au réseau pour les envoyer, ou confirmez pour vous déconnecter quand même.`)) return;
        await api.post("/auth/logout", { force: true }).catch(() => {});
      }
    }
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {[
        ...NAV,
        ...(user.reportCount > 0 ? [{ href: "/team", label: "Mon équipe", icon: UsersRound }] : []),
        { href: "/preferences", label: "Préférences", icon: Settings },
        // L'administration est toujours la dernière entrée du menu.
        ...(user.isAdmin ? [{ href: "/admin", label: "Administration", icon: ShieldCheck }] : []),
      ].map(({ href, label, icon: Icon }) => {
        // Éléments épinglés, indentés sous « Projets » et « Cartes mentales ».
        const pinned =
          href === "/projects"
            ? pins.projects.map((p) => ({ href: `/projects/${p.id}`, label: p.name, color: p.color }))
            : href === "/mindmaps"
              ? pins.mindmaps.map((m) => ({ href: `/mindmaps/${m.id}`, label: m.title, color: null as string | null }))
              : [];
        const onPinned = pinned.some((p) => pathname === p.href || pathname.startsWith(p.href + "/"));
        const active = !onPinned && (pathname === href || pathname.startsWith(href + "/"));
        return (
          <Fragment key={href}>
          <Link
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
            <span className="flex-1">{label}</span>
            {href === "/messages" && <UnreadBadge count={unreadMessages} />}
          </Link>
          {pinned.length > 0 && (
            <ul className="mb-1 ml-5 flex flex-col gap-0.5 border-l border-line pl-2" aria-label={`${label} épinglés`}>
              {pinned.map((p) => {
                const on = pathname === p.href || pathname.startsWith(p.href + "/");
                return (
                  <li key={p.href}>
                    <Link
                      href={p.href}
                      onClick={() => setOpen(false)}
                      aria-current={on ? "page" : undefined}
                      title={p.label}
                      className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors md:py-1 ${on ? "bg-brand-50 font-medium text-brand-700" : "text-ink-2 hover:bg-surface-2"}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? "var(--color-line-strong)" }} aria-hidden />
                      <span className="truncate">{p.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          </Fragment>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto border-t border-line pt-3">
      <Link href="/preferences" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2" title="Préférences">
        <Avatar id={user.id} name={user.name} src={user.avatarUrl} size={32} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={logout}
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-2"
      >
        <LogOut className="h-4 w-4" /> Se déconnecter
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Barre latérale (≥ md) */}
      {/* Pas d'overflow sur la barre elle-même (il rognerait le panneau des notifications, qui
          déborde sur le contenu) : seul le menu défile. z-40 : la barre « sticky » forme son propre
          contexte d'empilement, il doit passer au-dessus du contenu principal. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:sticky md:top-0 md:z-40 md:flex md:h-dvh">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-base text-on-brand">🧠</span>
            <span className="truncate">Second Brain</span>
          </Link>
          <NotificationsBell align="left" />
        </div>
        {statusSlot}
        <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-1">{nav}</div>
        {footer}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure (mobile) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm text-on-brand">🧠</span>
            Second Brain
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/messages" aria-label="Messages" className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2">
              <MessagesSquare className="h-5 w-5" />
              <UnreadBadge count={unreadMessages} className="absolute -right-0.5 -top-0.5" />
            </Link>
            <NotificationsBell align="right" />
            <button type="button" onClick={() => setOpen(true)} aria-label="Menu" aria-expanded={open} aria-controls="app-drawer" className="rounded-lg p-2 hover:bg-surface-2">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        {open && (
          <div id="app-drawer" className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-surface p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-semibold">Menu</span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Fermer le menu" className="rounded-lg p-2 hover:bg-surface-2">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {statusSlot}
              {nav}
              {footer}
            </div>
          </div>
        )}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
