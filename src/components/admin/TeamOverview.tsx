"use client";

import { useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import type { OverviewTask } from "@/lib/tasks";
import { Avatar, PageHeader, isFinished } from "@/components/ui";
import { TaskOverviewTable } from "./TaskOverviewTable";

type Member = { id: string; name: string; email: string; avatarUrl: string | null };

/**
 * « Mon équipe » (manager) : mes N-1 directs, avec leur charge (tâches
 * ouvertes) ; un clic sur une personne filtre ses tâches. Fiches en lecture
 * seule.
 */
export function TeamOverview({ members, tasks }: { members: Member[]; tasks: OverviewTask[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const openCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (!isFinished(t.status)) for (const id of t.peopleUserIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [tasks]);
  const visible = selected ? tasks.filter((t) => t.peopleUserIds.includes(selected)) : tasks;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader title="Mon équipe" subtitle="Les tâches de vos collaborateurs directs (N-1), en lecture seule." />
      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
          <UsersRound className="mx-auto mb-2 h-8 w-8 text-faint" />
          Personne ne vous est rattaché. Un administrateur peut vous désigner comme manager dans l&apos;administration.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={`rounded-full border px-3 py-1.5 text-sm ${selected === null ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface hover:bg-surface-2"}`}
            >
              Toute l&apos;équipe
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelected(selected === m.id ? null : m.id)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${selected === m.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface hover:bg-surface-2"}`}
                title={m.email}
              >
                <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={26} />
                {m.name}
                <span className="rounded-full bg-surface-3 px-1.5 text-xs text-muted">{openCount.get(m.id) ?? 0}</span>
              </button>
            ))}
          </div>
          <TaskOverviewTable tasks={visible} showOwner={false} />
        </>
      )}
    </div>
  );
}
