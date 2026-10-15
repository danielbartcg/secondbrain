"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Circle, CircleDot, ExternalLink, Link2, ListTodo, Lock, Plus, Unlink, X } from "lucide-react";
import { api } from "@/lib/client";
import type { NodeTasksResult } from "@/lib/tasks";
import type { TaskMutation } from "@/lib/projects";
import type { SearchHit } from "@/lib/search";
import { Button, PriorityFlag, TASK_STATUS_LABEL, errorMessage, inputClass, toast } from "@/components/ui";

/**
 * Tâches d'un nœud de carte mentale (panneau latéral) : liste des tâches
 * rattachées (statut cliquable, lien vers la fiche, détachement), création
 * d'une nouvelle tâche (sans projet, rattachée au nœud) ou rattachement d'une
 * tâche existante via une recherche. Remonte les compteurs au parent pour
 * l'indicateur visuel du nœud.
 */
export function NodeTasksPanel({
  mapId,
  nodeId,
  onCounts,
}: {
  mapId: string;
  nodeId: string;
  onCounts: (nodeId: string, counts: { taskCount: number; openTaskCount: number }) => void;
}) {
  const [data, setData] = useState<NodeTasksResult | null>(null);
  const [mode, setMode] = useState<"none" | "create" | "link">("none");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const base = `/mindmaps/${mapId}/nodes/${nodeId}/tasks`;

  const apply = (r: NodeTasksResult) => {
    setData(r);
    onCounts(nodeId, { taskCount: r.taskCount, openTaskCount: r.openTaskCount });
  };

  useEffect(() => {
    let alive = true;
    setData(null);
    setMode("none");
    api
      .get<NodeTasksResult>(base)
      .then((r) => alive && apply(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Recherche de tâches existantes (différée).
  useEffect(() => {
    if (mode !== "link" || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { results } = await api.get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(query.trim())}&kinds=task&limit=8`).catch(() => ({ results: [] }));
      if (id === seq.current) setHits(results.filter((h) => !data?.tasks.some((t) => t.id === h.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode, data]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await api.post<TaskMutation>("/tasks", { name: n, nodeId });
      apply(await api.get<NodeTasksResult>(base));
      setName("");
    } catch (e) {
      toast(errorMessage(e, "Création impossible."), "error");
    } finally {
      setBusy(false);
    }
  }
  async function link(taskId: string) {
    setBusy(true);
    try {
      apply(await api.post<NodeTasksResult>(base, { taskId }));
      setQuery("");
      setMode("none");
    } catch (e) {
      toast(errorMessage(e, "Rattachement impossible."), "error");
    } finally {
      setBusy(false);
    }
  }
  async function unlink(taskId: string) {
    try {
      apply(await api.delete<NodeTasksResult>(`${base}/${taskId}`));
    } catch (e) {
      toast(errorMessage(e, "Détachement impossible."), "error");
    }
  }
  async function cycleStatus(taskId: string, status: string) {
    const next = { TODO: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "TODO", CLOSED: "TODO" }[status];
    try {
      await api.patch<TaskMutation>(`/tasks/${taskId}`, { status: next });
      apply(await api.get<NodeTasksResult>(base));
    } catch (e) {
      toast(errorMessage(e, "Changement de statut impossible."), "error");
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-muted">
          <ListTodo className="h-3.5 w-3.5" /> Tâches
        </span>
        {data && data.openTaskCount > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[11px] font-medium text-brand-700">{data.openTaskCount} ouverte{data.openTaskCount > 1 ? "s" : ""}</span>}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={mode === "create" ? "primary" : "outline"} onClick={() => setMode(mode === "create" ? "none" : "create")} title="Créer une tâche rattachée à ce nœud">
            <Plus className="h-3.5 w-3.5" /> Nouvelle
          </Button>
          <Button size="sm" variant={mode === "link" ? "primary" : "outline"} onClick={() => setMode(mode === "link" ? "none" : "link")} title="Rattacher une tâche existante">
            <Link2 className="h-3.5 w-3.5" /> Existante
          </Button>
        </div>
      </div>

      {mode === "create" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="mb-2 flex gap-1.5"
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la tâche (sans projet, rattachée au nœud)" aria-label="Nom de la nouvelle tâche" className={`${inputClass} min-w-0 flex-1 py-1.5`} />
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Créer
          </Button>
        </form>
      )}
      {mode === "link" && (
        <div className="relative mb-2">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une tâche existante…" aria-label="Rechercher une tâche existante" className={`${inputClass} w-full py-1.5`} />
          {hits.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => link(h.id)} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-surface-2">
                    <span className="truncate text-sm">{h.title}</span>
                    <span className="truncate text-[11px] text-muted">{h.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-[11px] text-muted">Aucune tâche trouvée.</p>}
        </div>
      )}

      {!data ? (
        <p className="text-xs text-faint">Chargement…</p>
      ) : data.tasks.length === 0 ? (
        <p className="text-xs text-muted">Aucune tâche rattachée à ce nœud.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.tasks.map((t) => {
            const closed = t.status === "CLOSED";
            const done = t.status === "DONE" || closed;
            return (
              <li key={t.id} className={`flex items-center gap-1.5 px-2 py-1.5 text-sm ${closed ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  onClick={() => cycleStatus(t.id, t.status)}
                  title={`Statut : ${TASK_STATUS_LABEL[t.status]} (cliquer pour changer)`}
                  aria-label={`Statut : ${TASK_STATUS_LABEL[t.status]} — changer`}
                  className={`-m-1 shrink-0 rounded p-1 ${closed ? "text-violet-700" : done ? "text-ok" : t.status === "IN_PROGRESS" ? "text-brand-600" : "text-faint"}`}
                >
                  {closed ? <Lock className="h-4 w-4" /> : done ? <Check className="h-4 w-4" /> : t.status === "IN_PROGRESS" ? <CircleDot className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </button>
                <PriorityFlag priority={t.priority} />
                <span className="min-w-0 flex-1">
                  <Link href={`/tasks/${t.id}`} className={`block truncate hover:underline ${done ? "text-muted line-through" : ""}`}>
                    {t.name}
                  </Link>
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.projectColor ?? "#94a3b8" }} /> {t.projectName}
                  </span>
                </span>
                <Link href={`/tasks/${t.id}`} className="rounded p-2 text-muted hover:bg-surface-2 md:p-1" title="Ouvrir la fiche" aria-label="Ouvrir la fiche tâche">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button type="button" onClick={() => unlink(t.id)} className="rounded p-2 text-faint hover:bg-red-50 hover:text-danger md:p-1" title="Détacher du nœud (la tâche est conservée)" aria-label={`Détacher « ${t.name} » du nœud`}>
                  <Unlink className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mode !== "none" && (
        <button type="button" onClick={() => setMode("none")} className="mt-1 flex items-center gap-1 text-[11px] text-muted hover:text-ink">
          <X className="h-3 w-3" /> Fermer
        </button>
      )}
    </div>
  );
}
