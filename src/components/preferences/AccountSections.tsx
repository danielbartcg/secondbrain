"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Copy, KeyRound, Loader2, Mail, MailCheck, MailQuestion, Plus, Trash2 } from "lucide-react";
import { api, serverOriginOf } from "@/lib/client";
import type { ProfileDto } from "@/lib/users";
import type { ApiKeyDto } from "@/lib/api-keys";
import { Button, Toggle, inputClass } from "@/components/ui";

/**
 * Préférences — sections « Adresse e-mail » (validation, changement, copies
 * e-mail des notifications) et « Connecteur Claude (MCP) » (clés d'accès).
 */

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

/** L'envoi d'e-mails est-il configuré sur la plateforme ? (null = inconnu, ex. hors ligne) */
function useMailConfigured(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .get<{ passwordReset: boolean }>("/auth/options")
      .then((r) => setV(r.passwordReset))
      .catch(() => setV(null));
  }, []);
  return v;
}

export function EmailSection({ profile, onProfile }: { profile: ProfileDto; onProfile: (p: ProfileDto) => void }) {
  const mail = useMailConfigured();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.post<{ email: string; verificationSent: boolean }>("/me/email", { email, currentPassword: password });
      onProfile({ ...profile, email: r.email, emailVerified: false });
      setEditing(false);
      setEmail("");
      setPassword("");
      setMessage({ ok: true, text: r.verificationSent ? `Adresse modifiée : un lien de validation a été envoyé à ${r.email}.` : `Adresse modifiée : ${r.email}. Utilisez-la désormais pour vous connecter.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, "Modification impossible.") });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setMessage(null);
    try {
      const r = await api.post<{ to: string }>("/me/email/verification");
      setMessage({ ok: true, text: `Lien de validation envoyé à ${r.to}.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, "Envoi impossible.") });
    }
  }

  async function setNotifications(v: boolean) {
    setNotifBusy(true);
    setMessage(null);
    const before = profile;
    onProfile({ ...profile, emailNotifications: v });
    try {
      const { profile: p } = await api.patch<{ profile: ProfileDto }>("/me", { emailNotifications: v });
      onProfile(p);
    } catch (err) {
      onProfile(before);
      setMessage({ ok: false, text: errorText(err, "Enregistrement impossible.") });
    } finally {
      setNotifBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Mail className="h-5 w-5 text-brand-600" /> Adresse e-mail
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium break-all">{profile.email}</span>
        {profile.emailVerified ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            <MailCheck className="h-3.5 w-3.5" /> Validée
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            <MailQuestion className="h-3.5 w-3.5" /> Non validée
          </span>
        )}
        {!profile.emailVerified && mail && (
          <button type="button" onClick={() => void resend()} className="text-sm font-medium text-brand-700 hover:underline">
            Envoyer le lien de validation
          </button>
        )}
        {!editing && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
            Changer d&apos;adresse
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">C&apos;est votre identifiant de connexion et l&apos;adresse des e-mails de la plateforme.</p>

      {editing && (
        <form onSubmit={changeEmail} className="mt-4 grid gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Nouvelle adresse</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className={`${inputClass} w-full`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Mot de passe actuel</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} w-full`} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy || !email.includes("@") || !password}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Changer l&apos;adresse
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
        <Toggle checked={profile.emailNotifications} onChange={(v) => void setNotifications(v)} disabled={notifBusy} label="Recevoir les notifications par e-mail" />
        <div className="text-sm">
          <div className="font-medium">Recevoir les notifications par e-mail</div>
          <div className="text-xs text-muted">
            Une copie de chaque notification (affectation, mention, réponse, message…) est envoyée à votre adresse.
            {mail === false && " L'envoi d'e-mails n'est pas encore configuré sur la plateforme : rien ne part pour l'instant."}
          </div>
        </div>
      </div>
      {message && (
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-danger"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

// --- Connecteur Claude (MCP) -----------------------------------------------------------------------

function serverOrigin(): string {
  return serverOriginOf("https://secondbrain.danielbar-tcg.fr");
}

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copié" : label}
    </Button>
  );
}

export function ConnectorSection() {
  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
  const [name, setName] = useState("Claude Desktop");
  const [canWrite, setCanWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  // Origine lue après le montage (évite un écart de rendu serveur / client).
  const [origin, setOrigin] = useState("https://secondbrain.danielbar-tcg.fr");
  const url = `${origin}/api/v1/mcp`;

  useEffect(() => {
    setOrigin(serverOrigin());
  }, []);

  useEffect(() => {
    api
      .get<{ apiKeys: ApiKeyDto[] }>("/me/api-keys")
      .then((r) => setKeys(r.apiKeys))
      .catch((e) => setError(errorText(e, "Chargement impossible.")));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ key: string; apiKey: ApiKeyDto }>("/me/api-keys", { name, canWrite });
      setKeys((k) => [r.apiKey, ...(k ?? [])]);
      setCreated(r.key);
    } catch (err) {
      setError(errorText(err, "Création impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyDto) {
    if (!confirm(`Révoquer la clé « ${k.name} » ? Les clients qui l'utilisent n'auront plus accès.`)) return;
    try {
      await api.delete(`/me/api-keys/${k.id}`);
      setKeys((list) => (list ?? []).filter((x) => x.id !== k.id));
    } catch (err) {
      setError(errorText(err, "Révocation impossible."));
    }
  }

  const config = (key: string) =>
    JSON.stringify(
      {
        mcpServers: {
          "second-brain": {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--header", "Authorization:${SB_AUTH}"],
            env: { SB_AUTH: `Bearer ${key}` },
          },
        },
      },
      null,
      2,
    );
  const claudeCode = (key: string) => `claude mcp add --transport http second-brain ${url} --header "Authorization: Bearer ${key}"`;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Bot className="h-5 w-5 text-brand-600" /> Connecteur Claude (MCP)
      </h2>
      <p className="mt-1 text-sm text-muted">
        Pilotez Second Brain depuis Claude Desktop (ou tout client MCP) : interroger <strong>et modifier</strong> projets, tâches, réunions, risques, cartes et notes
        (assigner, replanifier, rédiger un compte-rendu, tout ce que permet l&apos;application), avec exactement vos droits et une trace dans l&apos;historique.
        Une clé peut être limitée à la lecture. Un administrateur peut analyser les projets des autres en le demandant explicitement à Claude.
      </p>

      {created && (
        <div className="mt-4 space-y-3 rounded-xl border border-brand-500 bg-brand-50 p-3">
          <p className="text-sm font-medium text-brand-700">Votre clé — copiez-la maintenant, elle ne sera plus affichée :</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-2 py-1.5 text-xs">{created}</code>
            <CopyButton text={created} />
          </div>
          <div>
            <p className="text-sm font-medium">Claude Desktop</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-ink-2">
              <li>Installez Node.js (nodejs.org) si ce n&apos;est pas déjà fait.</li>
              <li>
                Claude Desktop → Paramètres → Développeur → <em>Modifier la configuration</em> (fichier <code>claude_desktop_config.json</code>), puis collez :
              </li>
            </ol>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-snug">{config(created)}</pre>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CopyButton text={config(created)} label="Copier la configuration" />
              <span className="text-xs text-muted">Puis redémarrez Claude Desktop : « second-brain » apparaît dans les outils.</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">Claude Code</p>
            <pre className="mt-1 overflow-auto rounded-lg bg-surface p-2 text-[11px]">{claudeCode(created)}</pre>
            <div className="mt-2">
              <CopyButton text={claudeCode(created)} label="Copier la commande" />
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
            J&apos;ai copié ma clé
          </Button>
        </div>
      )}

      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-muted">Nom de la clé</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`${inputClass} w-full`} placeholder="Ex. Claude Desktop (portable)" />
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer une clé
        </Button>
        <label className="flex w-full items-center gap-2 text-sm">
          <input type="checkbox" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-600)]" />
          Autoriser les modifications (créer, modifier, supprimer) — sinon lecture seule
        </label>
      </form>
      <p className="mt-2 text-xs text-muted">
        Adresse du serveur MCP : <code className="break-all">{url}</code>
      </p>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {keys === null && !error && <li className="px-3 py-2 text-sm text-muted">Chargement…</li>}
        {keys?.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucune clé pour l&apos;instant.</li>}
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-3 py-2">
            <KeyRound className="h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 truncate text-sm font-medium">
                {k.name}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${k.canWrite ? "bg-amber-50 text-amber-800" : "bg-surface-2 text-muted"}`}>{k.canWrite ? "Lecture et écriture" : "Lecture seule"}</span>
              </div>
              <div className="text-xs text-muted">
                <code>{k.prefix}…</code> · créée le {new Date(k.createdAt).toLocaleDateString("fr-FR")} ·{" "}
                {k.lastUsedAt ? `utilisée le ${new Date(k.lastUsedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : "jamais utilisée"}
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={() => void revoke(k)} aria-label={`Révoquer la clé ${k.name}`} title="Révoquer">
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
