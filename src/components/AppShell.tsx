"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brain, CalendarCheck2, FolderKanban, LayoutDashboard, LogOut, Menu, NotebookPen, X } from "lucide-react";
import { api } from "@/lib/client";
import { NotificationsBell } from "@/components/NotificationsBell";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/mindmaps", label: "Cartes mentales", icon: Brain },
  { href: "/projects", label: "Projets", icon: FolderKanban },
  { href: "/organize", label: "Mes tâches", icon: CalendarCheck2 },
  { href: "/notes", label: "Prise de notes", icon: NotebookPen },
];

/**
 * Coque applicative responsive : barre latérale fixe sur grand écran,
 * barre supérieure + tiroir sur mobile. Les pages « plein cadre » (éditeur
 * de carte) utilisent toute la hauteur restante.
 */
export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await api.post("/auth/logout").catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto border-t border-line pt-3">
      <div className="truncate px-3 text-sm font-medium">{user.name}</div>
      <div className="truncate px-3 text-xs text-muted">{user.email}</div>
      <button
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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-base text-on-brand">🧠</span>
            <span className="truncate">Second Brain</span>
          </Link>
          <NotificationsBell align="left" />
        </div>
        {nav}
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
            <NotificationsBell align="right" />
            <button onClick={() => setOpen(true)} aria-label="Menu" className="rounded-lg p-2 hover:bg-surface-2">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-semibold">Menu</span>
                <button onClick={() => setOpen(false)} aria-label="Fermer" className="rounded-lg p-2 hover:bg-surface-2">
                  <X className="h-5 w-5" />
                </button>
              </div>
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
