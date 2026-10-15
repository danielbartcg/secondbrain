"use client";

import { useMemo, useState } from "react";
import { Crown, Search, ShieldCheck, MailCheck, MailQuestion } from "lucide-react";
import { api } from "@/lib/client";
import type { AdminUserDto } from "@/lib/users";
import { Avatar, Badge, errorMessage, formatDate, selectClassXs, toast } from "@/components/ui";

/**
 * Gestion des utilisateurs : rôle (utilisateur / administrateur) et manager
 * (N+1). Un manager voit en lecture les tâches de ses N-1 (menu « Mon
 * équipe »). Le super administrateur n'est pas modifiable ; on ne peut pas
 * retirer son propre rôle d'administrateur ; les boucles hiérarchiques sont
 * refusées par le serveur.
 */
export function AdminUsers({ initial, currentUserId }: { initial: AdminUserDto[]; currentUserId: string }) {
  const [users, setUsers] = useState(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function update(id: string, data: { role?: "USER" | "ADMIN"; managerId?: string | null }) {
    setBusy(id);
    try {
      const { users } = await api.patch<{ users: AdminUserDto[] }>(`/admin/users/${id}`, data);
      setUsers(users);
    } catch (e) {
      toast(errorMessage(e, "Modification impossible."), "error");
    } finally {
      setBusy(null);
    }
  }

  const needle = q.trim().toLowerCase();
  const visible = users.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle));
  const admins = users.filter((u) => u.isAdmin).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 sm:max-w-xs">
          <Search className="h-4 w-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un nom ou un e-mail" aria-label="Rechercher un nom ou un e-mail" className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none sm:text-sm" />
        </label>
        <span className="text-xs text-muted">
          {users.length} compte{users.length > 1 ? "s" : ""} · {admins} administrateur{admins > 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Personne</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Manager (N+1)</th>
              <th className="px-3 py-2">N-1</th>
              <th className="px-3 py-2">Projets</th>
              <th className="px-3 py-2">Inscrit le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((u) => (
              <tr key={u.id} className={busy === u.id ? "opacity-60" : ""}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar id={u.id} name={u.name} src={u.avatarUrl} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate font-medium">
                        {u.name}
                        {u.id === currentUserId && <span className="text-xs font-normal text-muted">(vous)</span>}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">{u.email}</span>
                        {u.emailVerified ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-green-700" title="Adresse e-mail validée">
                            <MailCheck className="h-3.5 w-3.5" aria-hidden /> validée
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-faint" title="Adresse e-mail non validée (sans effet sur la connexion)">
                            <MailQuestion className="h-3.5 w-3.5" aria-hidden /> non validée
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {u.isSuperAdmin ? (
                    <Badge tone="violet">
                      <Crown className="h-3 w-3" /> Super administrateur
                    </Badge>
                  ) : (
                    <select
                      value={u.role}
                      disabled={busy === u.id || u.id === currentUserId}
                      title={u.id === currentUserId ? "Vous ne pouvez pas modifier votre propre rôle" : undefined}
                      aria-label={`Rôle de ${u.name}`}
                      onChange={(e) => {
                        const role = e.target.value as "USER" | "ADMIN";
                        const msg =
                          role === "ADMIN"
                            ? `Donner le rôle d'administrateur à ${u.name} ? Cette personne verra l'administration.`
                            : `Retirer le rôle d'administrateur à ${u.name} ?`;
                        if (confirm(msg)) void update(u.id, { role });
                      }}
                      className={`${selectClassXs} disabled:opacity-60`}
                    >
                      <option value="USER">Utilisateur</option>
                      <option value="ADMIN">Administrateur</option>
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select value={u.managerId ?? ""} disabled={busy === u.id} aria-label={`Manager de ${u.name}`} onChange={(e) => void update(u.id, { managerId: e.target.value || null })} className={`${selectClassXs} max-w-[14rem]`}>
                    <option value="">— Aucun —</option>
                    {users
                      .filter((m) => m.id !== u.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {u.reportIds.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div className="flex -space-x-1.5" title={u.reportIds.map((id) => byId.get(id)?.name).join(", ")}>
                      {u.reportIds.slice(0, 5).map((id) => {
                        const r = byId.get(id);
                        return r ? <Avatar key={id} id={r.id} name={r.name} src={r.avatarUrl} size={24} className="ring-2 ring-surface" /> : null;
                      })}
                      {u.reportIds.length > 5 && <span className="ml-2 text-xs text-muted">+{u.reportIds.length - 5}</span>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink-2">{u.projectCount}</td>
                <td className="px-3 py-2 text-xs text-muted">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted">
                  Aucun compte ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted">
        <ShieldCheck className="h-3.5 w-3.5" /> Un administrateur voit l&apos;administration. Un manager voit en lecture les tâches de ses N-1 dans « Mon équipe ».
      </p>
    </div>
  );
}
