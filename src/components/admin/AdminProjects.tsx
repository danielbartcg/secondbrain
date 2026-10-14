"use client";

import Link from "next/link";
import { FolderKanban } from "lucide-react";
import type { AdminProjectSummary } from "@/lib/projects";
import { STATUS_LABEL } from "@/components/projects/ProjectList";
import { ProgressBar, formatDate } from "@/components/ui";

/** Tous les projets, tous propriétaires (lecture seule). */
export function AdminProjects({ projects }: { projects: AdminProjectSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Projet</th>
            <th className="px-3 py-2">Propriétaire</th>
            <th className="px-3 py-2">Statut</th>
            <th className="px-3 py-2">Avancement</th>
            <th className="px-3 py-2">Équipe</th>
            <th className="px-3 py-2">Tâches</th>
            <th className="px-3 py-2">Modifié</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {projects.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2/60">
              <td className="px-3 py-2">
                <Link href={`/admin/projects/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: p.color ?? "var(--color-brand-600)" }}>
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  <span className="truncate">{p.name}</span>
                </Link>
              </td>
              <td className="px-3 py-2">
                <div className="truncate">{p.ownerName}</div>
                <div className="truncate text-xs text-muted">{p.ownerEmail}</div>
              </td>
              <td className="px-3 py-2 text-xs">{STATUS_LABEL[p.status]}</td>
              <td className="px-3 py-2">
                <div className="flex w-36 items-center gap-2">
                  <ProgressBar percent={p.progress.percent} color={p.color} className="h-1.5" />
                  <span className="w-9 text-right text-xs tabular-nums">{p.progress.percent}%</span>
                </div>
              </td>
              <td className="px-3 py-2 tabular-nums">{p.memberCount}</td>
              <td className="px-3 py-2 tabular-nums">
                {p.progress.done}/{p.taskCount}
              </td>
              <td className="px-3 py-2 text-xs text-muted">{formatDate(p.updatedAt)}</td>
            </tr>
          ))}
          {projects.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-muted">
                Aucun projet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
