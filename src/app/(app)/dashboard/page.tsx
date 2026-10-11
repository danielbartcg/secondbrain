import Link from "next/link";
import { Brain, FolderKanban, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listMindMaps } from "@/lib/mindmaps";
import { listProjects } from "@/lib/projects";
import { ProgressBar } from "@/components/ui";

export const metadata = { title: "Tableau de bord" };

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} j`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [maps, projects] = await Promise.all([listMindMaps(user.id), listProjects(user.id)]);
  const active = projects.filter((p) => p.status === "ACTIVE");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Bonjour {user.name} 👋</h1>
      <p className="mt-1 text-sm text-muted">Reprenez là où vous en étiez.</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Brain className="h-5 w-5 text-brand-600" /> Cartes mentales
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{maps.length}</span>
            </h2>
            <Link href="/mindmaps" className="text-sm font-medium text-brand-600 hover:underline">
              Tout voir
            </Link>
          </div>
          {maps.length === 0 ? (
            <Link href="/mindmaps" className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-muted hover:bg-surface-2">
              <Plus className="h-4 w-4" /> Créer votre première carte
            </Link>
          ) : (
            <ul className="divide-y divide-line">
              {maps.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link href={`/mindmaps/${m.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-700">
                    <span className="truncate font-medium">{m.title}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {m.nodeCount} nœud{m.nodeCount > 1 ? "s" : ""} · {relative(m.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <FolderKanban className="h-5 w-5 text-brand-600" /> Projets actifs
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{active.length}</span>
            </h2>
            <Link href="/projects" className="text-sm font-medium text-brand-600 hover:underline">
              Tout voir
            </Link>
          </div>
          {active.length === 0 ? (
            <Link href="/projects" className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-muted hover:bg-surface-2">
              <Plus className="h-4 w-4" /> Créer votre premier projet
            </Link>
          ) : (
            <ul className="space-y-3">
              {active.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="block rounded-lg p-2 -m-2 hover:bg-surface-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 truncate font-medium">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? "var(--color-brand-500)" }} />
                        {p.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {p.progress.done}/{p.progress.total} tâches · {p.progress.percent}%
                      </span>
                    </div>
                    <ProgressBar percent={p.progress.percent} color={p.color} className="mt-2" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
