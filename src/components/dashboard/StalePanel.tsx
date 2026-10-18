"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Moon } from "lucide-react";
import { api } from "@/lib/client";
import type { StaleOverview } from "@/lib/freshness";
import { TASK_STATUS_LABEL } from "@/components/ui";

/**
 * Tableau de bord — « Endormis » : mes tâches ouvertes et mes projets actifs
 * sans activité depuis N jours (Préférences → Fraîcheur). En ligne : masqué
 * si le serveur est injoignable ou s'il n'y a rien à signaler.
 */
export function StalePanel() {
  const [data, setData] = useState<StaleOverview | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ stale: StaleOverview }>("/me/stale")
      .then((r) => alive && setData(r.stale))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!data || (data.taskCount === 0 && data.projects.length === 0)) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Moon className="h-5 w-5 text-amber-600" /> Endormis
          <span className="text-sm font-normal text-muted">sans activité depuis {data.days} jours ou plus</span>
        </h2>
        <Link href="/preferences#fraicheur" className="text-xs font-medium text-brand-600 hover:underline">
          Régler le seuil
        </Link>
      </div>

      {data.projects.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Projets endormis">
          {data.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2">
                <FolderKanban className="h-3.5 w-3.5" style={{ color: p.color ?? "var(--color-brand-600)" }} aria-hidden />
                <span className="max-w-[14rem] truncate font-medium">{p.name}</span>
                <span className="text-muted">{p.idleDays} j</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.tasks.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {data.tasks.slice(0, 8).map((t) => (
            <li key={t.id}>
              <Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-brand-700">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t.projectName ?? "Sans projet"} · {TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" title={`Dernière activité le ${new Date(t.lastActivityAt).toLocaleDateString("fr-FR")}`}>
                  {t.idleDays} j
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.taskCount > 8 && (
        <p className="mt-2 text-xs text-muted">
          + {data.taskCount - 8} autre{data.taskCount - 8 > 1 ? "s" : ""} tâche{data.taskCount - 8 > 1 ? "s" : ""} endormie{data.taskCount - 8 > 1 ? "s" : ""}
          {" — "}
          <Link href="/organize" className="text-brand-600 hover:underline">
            organiser mes tâches
          </Link>
        </p>
      )}
    </section>
  );
}
