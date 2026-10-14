"use client";

import { useState } from "react";
import { Crown, Search, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import { Avatar, Button, InlineEdit, MEMBER_PALETTE, inputClass } from "@/components/ui";
import type { Resp, Run } from "./ProjectWorkspace";

/**
 * Équipe projet : membres rattachés à un compte (invités par e-mail) ou
 * simples noms. Seul le propriétaire gère l'équipe.
 */
export function TeamTab({ project, run, isOwner, currentUserId }: { project: ProjectDto; run: Run; isOwner: boolean; currentUserId: string }) {
  const [mode, setMode] = useState<"name" | "email">("name");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; email: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const allTasks = project.stages.flatMap((s) => [...s.tasks, ...s.activities.flatMap((a) => a.tasks)]);
  const tasksOf = (memberId: string) => allTasks.filter((t) => t.assigneeId === memberId);

  async function lookup() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { user } = await api.get<{ user: { id: string; name: string; email: string } | null }>(`/users/lookup?email=${encodeURIComponent(email.trim())}`);
      setFound(user);
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "email") {
      if (!found) return;
      await run(() => api.post<Resp>(`/projects/${project.id}/members`, { userId: found.id, role: role.trim() || null }));
      setEmail("");
      setFound(undefined);
    } else {
      if (!name.trim()) return;
      await run(() => api.post<Resp>(`/projects/${project.id}/members`, { name: name.trim(), role: role.trim() || null }));
      setName("");
    }
    setRole("");
  }

  const patch = (id: string, data: Record<string, unknown>) => run(() => api.patch<Resp>(`/members/${id}`, data));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <h2 className="font-semibold">Membres ({project.members.length})</h2>
        <ul className="mt-3 divide-y divide-line">
          {project.members.map((m) => {
            const tasks = tasksOf(m.id);
            const open = tasks.filter((t) => t.status !== "DONE").length;
            const owner = m.userId === project.ownerId;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <InlineEdit value={m.name} onSave={(v) => patch(m.id, { name: v })} className="-mx-1.5 font-medium" />
                    ) : (
                      <span className="font-medium">{m.name}</span>
                    )}
                    {owner && (
                      <span title="Propriétaire du projet" className="text-amber-500">
                        <Crown className="h-4 w-4" />
                      </span>
                    )}
                    {m.userId === currentUserId && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">moi</span>}
                    {m.userId ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">compte</span>
                    ) : (
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">externe</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    {isOwner ? (
                      <InlineEdit value={m.role ?? ""} placeholder="Rôle…" onSave={(v) => patch(m.id, { role: v })} className="-mx-1.5" />
                    ) : (
                      <span>{m.role ?? ""}</span>
                    )}
                    {m.email && <span>{m.email}</span>}
                    <span>
                      {tasks.length} tâche{tasks.length > 1 ? "s" : ""}
                      {open > 0 ? ` (${open} ouverte${open > 1 ? "s" : ""})` : ""}
                    </span>
                  </div>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    {MEMBER_PALETTE.map((c) => (
                      <button
                        key={c}
                        title="Couleur"
                        onClick={() => patch(m.id, { color: c })}
                        style={{ backgroundColor: c }}
                        className={`h-3.5 w-3.5 rounded-full ${m.color === c ? "ring-2 ring-brand-500 ring-offset-1" : "opacity-50 hover:opacity-100"}`}
                      />
                    ))}
                  </div>
                )}
                {isOwner && !owner && (
                  <button
                    title="Retirer de l'équipe"
                    onClick={() => {
                      if (confirm(`Retirer ${m.name} de l'équipe ? Ses tâches et livrables seront désaffectés.`)) void run(() => api.delete<Resp>(`/members/${m.id}`));
                    }}
                    className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {isOwner && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <UserPlus className="h-5 w-5 text-brand-600" /> Ajouter un membre
          </h2>
          <div className="mt-3 flex gap-1 rounded-lg bg-surface-2 p-1 text-xs font-medium">
            <button onClick={() => setMode("name")} className={`flex-1 rounded-md px-2 py-1.5 ${mode === "name" ? "bg-surface shadow-sm" : "text-muted"}`}>
              Nom libre
            </button>
            <button onClick={() => setMode("email")} className={`flex-1 rounded-md px-2 py-1.5 ${mode === "email" ? "bg-surface shadow-sm" : "text-muted"}`}>
              Compte de l&apos;application
            </button>
          </div>
          <form onSubmit={add} className="mt-3 space-y-2">
            {mode === "name" ? (
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la personne" className={`w-full ${inputClass}`} />
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFound(undefined);
                    }}
                    placeholder="E-mail du compte"
                    className={`min-w-0 flex-1 ${inputClass}`}
                  />
                  <Button type="button" variant="outline" onClick={lookup} disabled={busy || !email.includes("@")} title="Rechercher">
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
                {found === null && <p className="text-xs text-danger">Aucun compte avec cet e-mail. Ajoutez la personne en « nom libre » ou invitez-la à s&apos;inscrire.</p>}
                {found && (
                  <p className="flex items-center gap-2 text-xs text-ok">
                    <Avatar id={found.id} name={found.name} size={20} /> {found.name} ({found.email})
                  </p>
                )}
              </>
            )}
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Rôle (facultatif) : Chef de projet, Dév…" className={`w-full ${inputClass}`} />
            <Button type="submit" className="w-full" disabled={mode === "email" ? !found : !name.trim()}>
              <UserPlus className="h-4 w-4" /> Ajouter
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted">
            Un membre avec un compte voit ce projet dans son espace et retrouve ses tâches sur son tableau de bord. Un nom libre sert uniquement à l&apos;affectation.
          </p>
        </section>
      )}
    </div>
  );
}
