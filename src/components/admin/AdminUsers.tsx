"use client";

import { useId, useMemo, useState } from "react";
import { Check, Copy, Crown, Eye, EyeOff, KeyRound, Search, ShieldCheck, MailCheck, MailQuestion, UserPlus, Wand2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { AdminUserDto } from "@/lib/users";
import { Avatar, Badge, Button, errorMessage, formatDate, inputClass, selectClass, selectClassXs, toast } from "@/components/ui";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

/**
 * Gestion des utilisateurs : création de comptes avec mot de passe imposé,
 * réinitialisation forcée du mot de passe (sessions fermées), rôle
 * (utilisateur / administrateur) et manager (N+1). Un manager voit en lecture
 * les tâches de ses N-1 (menu « Mon équipe »). Le super administrateur n'est
 * pas modifiable ; on ne peut pas retirer son propre rôle d'administrateur ;
 * les boucles hiérarchiques sont refusées par le serveur.
 */

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_+=";

/** Mot de passe aléatoire fort (20 caractères, tirage sans biais via crypto.getRandomValues). */
function generatePassword(length = 20): string {
  const n = PASSWORD_CHARS.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < length) out += PASSWORD_CHARS[b % n];
    }
  }
  return out;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Mot de passe copié.");
  } catch {
    toast("Copie impossible : sélectionnez le mot de passe à la main.", "error");
  }
}

/** Champ mot de passe : afficher / masquer, générer, copier, jauge de sécurité. */
function PasswordField({ value, onChange, personal, label = "Mot de passe" }: { value: string; onChange: (v: string) => void; personal: string[]; label?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line-strong bg-surface focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
          <input
            id={id}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            minLength={8}
            maxLength={72}
            required
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-base outline-none sm:text-sm"
          />
          <button type="button" onClick={() => setVisible((v) => !v)} className="p-2 text-muted hover:text-ink" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} title={visible ? "Masquer" : "Afficher"}>
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            onChange(generatePassword());
            setVisible(true);
          }}
        >
          <Wand2 className="h-4 w-4" /> Générer
        </Button>
        <Button variant="outline" disabled={!value} onClick={() => void copyText(value)}>
          <Copy className="h-4 w-4" /> Copier
        </Button>
      </div>
      <PasswordStrengthMeter password={value} personal={personal} />
    </div>
  );
}

type CreateForm = { firstName: string; lastName: string; email: string; password: string; role: "USER" | "ADMIN"; managerId: string };
const EMPTY_FORM: CreateForm = { firstName: "", lastName: "", email: "", password: "", role: "USER", managerId: "" };

export function AdminUsers({ initial, currentUserId }: { initial: AdminUserDto[]; currentUserId: string }) {
  const [users, setUsers] = useState(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const fieldId = useId();

  // Création de compte
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  // Réinitialisation du mot de passe
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);
  const resetUser = resetFor ? byId.get(resetFor) ?? null : null;

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateBusy(true);
    try {
      const { users } = await api.post<{ users: AdminUserDto[] }>("/admin/users", {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        role: form.role,
        managerId: form.managerId || null,
      });
      setUsers(users);
      setCreated({ email: form.email.trim().toLowerCase(), password: form.password });
      setForm(EMPTY_FORM);
      setCreating(false);
    } catch (err) {
      setCreateError(errorMessage(err, "Création impossible."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    if (!confirm(`Imposer ce nouveau mot de passe à ${resetUser.name} ? Toutes ses sessions (web et applications) seront fermées : la personne devra se reconnecter avec ce mot de passe.`)) return;
    setResetError(null);
    setResetBusy(true);
    try {
      await api.post<{ ok: true }>(`/admin/users/${resetUser.id}/password`, { password: resetPassword });
      setResetDone(resetUser.name);
      setResetFor(null);
      setResetPassword("");
    } catch (err) {
      setResetError(errorMessage(err, "Réinitialisation impossible."));
    } finally {
      setResetBusy(false);
    }
  }

  function openReset(id: string) {
    setResetFor(id);
    setResetPassword("");
    setResetError(null);
    setResetDone(null);
    // Le panneau s'affiche au-dessus du tableau : on le ramène à l'écran.
    window.setTimeout(() => document.getElementById(`${fieldId}-reset-title`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

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
        <Button
          className="ml-auto"
          aria-expanded={creating}
          onClick={() => {
            setCreating((v) => !v);
            setCreateError(null);
            setCreated(null);
          }}
        >
          <UserPlus className="h-4 w-4" /> Créer un compte
        </Button>
      </div>

      {created && (
        <div role="status" className="mb-3 flex flex-wrap items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Compte créé pour {created.email}.</p>
            <p className="text-xs text-muted">
              Communiquez le mot de passe par un canal sûr (de vive voix, gestionnaire de mots de passe…), jamais dans le même message que l&apos;adresse. Invitez la personne à le changer dès sa première connexion (Profil).
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void copyText(created.password)}>
            <Copy className="h-3.5 w-3.5" /> Copier le mot de passe
          </Button>
          <button type="button" onClick={() => setCreated(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fermer le message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {creating && (
        <form onSubmit={createAccount} className="mb-4 rounded-2xl border border-line bg-surface p-4" aria-labelledby={`${fieldId}-title`}>
          <h2 id={`${fieldId}-title`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4" /> Nouveau compte
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-first`} className="mb-1 block text-xs font-medium text-ink-2">
                Prénom
              </label>
              <input id={`${fieldId}-first`} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={60} autoComplete="off" className={`${inputClass} w-full`} />
            </div>
            <div>
              <label htmlFor={`${fieldId}-last`} className="mb-1 block text-xs font-medium text-ink-2">
                Nom
              </label>
              <input id={`${fieldId}-last`} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={60} autoComplete="off" className={`${inputClass} w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${fieldId}-email`} className="mb-1 block text-xs font-medium text-ink-2">
                E-mail
              </label>
              <input id={`${fieldId}-email`} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} autoComplete="off" className={`${inputClass} w-full`} />
            </div>
            <PasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} personal={[form.email, form.firstName, form.lastName]} />
            <div>
              <label htmlFor={`${fieldId}-role`} className="mb-1 block text-xs font-medium text-ink-2">
                Rôle
              </label>
              <select id={`${fieldId}-role`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "USER" | "ADMIN" })} className={`${selectClass} w-full`}>
                <option value="USER">Utilisateur</option>
                <option value="ADMIN">Administrateur</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-manager`} className="mb-1 block text-xs font-medium text-ink-2">
                Manager (N+1)
              </label>
              <select id={`${fieldId}-manager`} value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} className={`${selectClass} w-full`}>
                <option value="">— Aucun —</option>
                {users.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {createError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {createError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={createBusy}>
              Annuler
            </Button>
            <button type="submit" disabled={createBusy || !form.email || form.password.length < 8 || (!form.firstName.trim() && !form.lastName.trim())} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-on-brand hover:bg-brand-700 disabled:opacity-50">
              {createBusy ? "Création…" : "Créer le compte"}
            </button>
          </div>
        </form>
      )}

      {resetDone && (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
          <p className="min-w-0 flex-1">
            Mot de passe de {resetDone} réinitialisé ; ses sessions ont été fermées. Communiquez-lui le nouveau mot de passe par un canal sûr.
          </p>
          <button type="button" onClick={() => setResetDone(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fermer le message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {resetUser && (
        <form onSubmit={submitReset} className="mb-4 rounded-2xl border border-line bg-surface p-4" aria-labelledby={`${fieldId}-reset-title`}>
          <h2 id={`${fieldId}-reset-title`} className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4" /> Réinitialiser le mot de passe de {resetUser.name}
          </h2>
          <p className="mb-3 text-xs text-muted">Le nouveau mot de passe remplace l&apos;actuel et toutes les sessions de la personne (web et applications) sont fermées.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PasswordField label="Nouveau mot de passe" value={resetPassword} onChange={setResetPassword} personal={[resetUser.email, resetUser.name]} />
          </div>
          {resetError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {resetError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetFor(null)} disabled={resetBusy}>
              Annuler
            </Button>
            <button type="submit" disabled={resetBusy || resetPassword.length < 8} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-on-brand hover:bg-brand-700 disabled:opacity-50">
              {resetBusy ? "Enregistrement…" : "Imposer ce mot de passe"}
            </button>
          </div>
        </form>
      )}

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
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
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
                <td className="px-3 py-2 text-right">
                  {/* Son propre mot de passe se change depuis le profil ; le super administrateur n'est réinitialisable que par lui-même. */}
                  {u.id !== currentUserId && !(u.isSuperAdmin && !byId.get(currentUserId)?.isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => openReset(u.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                      title="Réinitialiser le mot de passe"
                      aria-label={`Réinitialiser le mot de passe de ${u.name}`}
                    >
                      <KeyRound className="h-4 w-4" /> <span className="hidden lg:inline">Mot de passe</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7}className="px-3 py-8 text-center text-sm text-muted">
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
