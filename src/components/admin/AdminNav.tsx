"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, ListTodo, Users } from "lucide-react";

const TABS = [
  { href: "/admin/users", label: "Utilisateurs", icon: Users },
  { href: "/admin/projects", label: "Tous les projets", icon: FolderKanban },
  { href: "/admin/tasks", label: "Toutes les tâches", icon: ListTodo },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div className="scrollbar-none mt-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        );
      })}
    </div>
  );
}
