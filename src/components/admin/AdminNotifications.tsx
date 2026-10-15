"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Toggle, inputClass } from "@/components/ui";
import type { NotificationSettingsDto } from "@/lib/settings";
import { NOTIFICATION_TYPE_INFO } from "@/lib/shared/notification-types";

/**
 * Administration → Notifications :
 *  1. paramètres SMTP et interrupteur général « doubler les notifications d'un e-mail » ;
 *  2. récapitulatif de toutes les notifications, chacune activable pour tout le
 *     monde (cloche + e-mail) et, séparément, sa copie e-mail.
 */

export function AdminNotifications({ initial, adminEmail }: { initial: NotificationSettingsDto; adminEmail: string }) {
  const [settings, setSettings] = useState(initial);
  const [form, setForm] = useState({
    smtpHost: initial.smtpHost,
    smtpPort: String(initial.smtpPort),
    smtpSecure: initial.smtpSecure,
    smtpUser: initial.smtpUser,
    smtpPassword: "",
    smtpFrom: initial.smtpFrom,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);

  const smtpDirty =
    form.smtpHost !== settings.smtpHost ||
    form.smtpPort !== String(settings.smtpPort) ||
    form.smtpSecure !== settings.smtpSecure ||
    form.smtpUser !== settings.smtpUser ||
    form.smtpPassword !== "" ||
    form.smtpFrom !== settings.smtpFrom;
  const smtpReady = !!settings.smtpHost && !!settings.smtpFrom;

  async function patch(body: Record<string, unknown>): Promise<NotificationSettingsDto> {
    const r = await api.patch<{ settings: NotificationSettingsDto }>("/admin/notifications", body);
    setSettings(r.settings);
    return r.settings;
  }

  async function saveSmtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    const port = Number(form.smtpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setMessage({ tone: "error", text: "Port invalide (1 à 65535)." });
    setSaving(true);
    setMessage(null);
    try {
      await patch({
        smtpHost: form.smtpHost,
        smtpPort: port,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser,
        smtpFrom: form.smtpFrom,
        ...(form.smtpPassword ? { smtpPassword: form.smtpPassword } : {}),
      });
      setForm((f) => ({ ...f, smtpPassword: "" }));
      setMessage({ tone: "ok", text: "Paramètres SMTP enregistrés." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Enregistrement impossible." });
    } finally {
      setSaving(false);
    }
  }

  async function clearPassword() {
    if (!confirm("Effacer le mot de passe SMTP enregistré ?")) return;
    try {
      await patch({ smtpPassword: "" });
      setMessage({ tone: "ok", text: "Mot de passe effacé." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Opération impossible." });
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setMessage(null);
    try {
      if (smtpDirty) await saveSmtp();
      const r = await api.post<{ to: string }>("/admin/notifications/test");
      setMessage({ tone: "ok", text: `E-mail de test envoyé à ${r.to}. Vérifiez la boîte de réception (et les indésirables).` });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Envoi impossible." });
    } finally {
      setTesting(false);
    }
  }

  async function setEmailEnabled(v: boolean) {
    setMessage(null);
    const before = settings;
    setSettings({ ...settings, emailEnabled: v });
    try {
      await patch({ emailEnabled: v });
    } catch (err) {
      setSettings(before);
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Opération impossible." });
    }
  }

  async function setType(type: NotificationSettingsDto["types"][number]["type"], field: "enabled" | "email", v: boolean) {
    setTypesError(null);
    const before = settings;
    const types = settings.types.map((t) => (t.type === type ? { ...t, [field]: v } : t));
    setSettings({ ...settings, types });
    try {
      await patch({ types });
    } catch (err) {
      setSettings(before);
      setTypesError(err instanceof Error ? err.message : "Opération impossible.");
    }
  }

  const field = "mt-1 w-full " + inputClass;

  return (
    <div className="space-y-6">
      {/* 1. E-mails */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-semibold">
              <Mail className="h-5 w-5 text-brand-600" /> Envoi des notifications par e-mail
            </h2>
            <p className="mt-1 text-sm text-muted">Chaque notification de la cloche est doublée d&apos;un e-mail à son destinataire (sauf types désactivés ci-dessous).</p>
          </div>
          <label className="flex items-center gap-3 text-sm font-medium">
            {settings.emailEnabled ? "Activé" : "Désactivé"}
            <Toggle checked={settings.emailEnabled} onChange={(v) => void setEmailEnabled(v)} disabled={!smtpReady && !settings.emailEnabled} label="Doubler les notifications d'un e-mail" />
          </label>
        </div>
        {!smtpReady && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Renseignez et enregistrez d&apos;abord le serveur SMTP et l&apos;adresse d&apos;expédition.</p>}

        <form onSubmit={saveSmtp} className="mt-4 grid gap-3 sm:grid-cols-6">
          <label className="text-sm font-medium sm:col-span-4">
            Serveur SMTP
            <input value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="smtp.exemple.fr" autoComplete="off" className={field} />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Port
            <input value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" className={field} />
          </label>
          <label className="flex items-center gap-3 text-sm sm:col-span-6">
            <Toggle
              checked={form.smtpSecure}
              onChange={(v) => setForm({ ...form, smtpSecure: v, smtpPort: form.smtpPort === "587" && v ? "465" : form.smtpPort === "465" && !v ? "587" : form.smtpPort })}
              label="Connexion TLS directe"
            />
            <span>
              <span className="font-medium">Connexion TLS directe</span>
              <span className="block text-xs text-muted">Activé : TLS dès la connexion (port 465). Désactivé : STARTTLS si le serveur le propose (port 587).</span>
            </span>
          </label>
          <label className="text-sm font-medium sm:col-span-3">
            Utilisateur
            <input value={form.smtpUser} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} autoComplete="off" placeholder="(vide : sans authentification)" className={field} />
          </label>
          <label className="text-sm font-medium sm:col-span-3">
            Mot de passe
            <input
              type="password"
              value={form.smtpPassword}
              onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
              autoComplete="new-password"
              placeholder={settings.smtpPasswordSet ? "•••••••• (inchangé)" : "Aucun"}
              className={field}
            />
            {settings.smtpPasswordSet && (
              <button type="button" onClick={() => void clearPassword()} className="mt-1 text-xs font-normal text-muted underline hover:text-danger">
                Effacer le mot de passe enregistré
              </button>
            )}
          </label>
          <label className="text-sm font-medium sm:col-span-6">
            Adresse d&apos;expédition
            <input value={form.smtpFrom} onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })} placeholder="Second Brain <noreply@exemple.fr>" className={field} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-6">
            <Button type="submit" disabled={saving || !smtpDirty}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button variant="outline" onClick={() => void sendTest()} disabled={testing || !form.smtpHost || !form.smtpFrom} title={`Envoyer un e-mail de test à ${adminEmail}`}>
              <Send className="h-4 w-4" /> {testing ? "Envoi…" : "Envoyer un e-mail de test"}
            </Button>
            <span className="text-xs text-muted">Le mot de passe est chiffré sur le serveur et n&apos;est jamais réaffiché.</span>
          </div>
        </form>
        {message && (
          <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-danger"}`}>
            {message.text}
          </p>
        )}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-xs text-muted">
          <div>
            <dt className="inline">E-mails envoyés (7 jours) : </dt>
            <dd className="inline font-medium text-ink-2">{settings.stats.sent}</dd>
          </div>
          <div>
            <dt className="inline">En attente : </dt>
            <dd className="inline font-medium text-ink-2">{settings.stats.pending}</dd>
          </div>
          <div>
            <dt className="inline">Échecs (7 jours) : </dt>
            <dd className={`inline font-medium ${settings.stats.failed ? "text-danger" : "text-ink-2"}`}>{settings.stats.failed}</dd>
          </div>
          {settings.stats.lastError && (
            <div className="w-full">
              <dt className="inline">Dernière erreur : </dt>
              <dd className="inline break-words text-danger">{settings.stats.lastError}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* 2. Types de notification */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-semibold">Notifications de la plateforme</h2>
        <p className="mt-1 text-sm text-muted">Réglage valable pour tout le monde. Une notification désactivée n&apos;apparaît plus dans la cloche et n&apos;est pas envoyée par e-mail.</p>
        {typesError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{typesError}</p>}
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          <li className="hidden items-center gap-4 bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted sm:flex">
            <span className="flex-1">Notification</span>
            <span className="w-20 text-center">Activée</span>
            <span className="w-20 text-center">E-mail</span>
          </li>
          {settings.types.map((t) => {
            const info = NOTIFICATION_TYPE_INFO[t.type];
            return (
              <li key={t.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <div className="text-sm font-medium">{info.label}</div>
                  <div className="text-xs text-muted">{info.description}</div>
                </div>
                <label className="flex w-auto items-center gap-2 text-xs text-muted sm:w-20 sm:justify-center">
                  <span className="sm:hidden">Activée</span>
                  <Toggle checked={t.enabled} onChange={(v) => void setType(t.type, "enabled", v)} label={`${info.label} : activée`} />
                </label>
                <label className="flex w-auto items-center gap-2 text-xs text-muted sm:w-20 sm:justify-center">
                  <span className="sm:hidden">E-mail</span>
                  <Toggle checked={t.enabled && t.email} onChange={(v) => void setType(t.type, "email", v)} disabled={!t.enabled} label={`${info.label} : copie e-mail`} />
                </label>
              </li>
            );
          })}
        </ul>
        {!settings.emailEnabled && <p className="mt-2 text-xs text-muted">Les copies e-mail ne partent que si l&apos;envoi par e-mail est activé ci-dessus.</p>}
      </section>
    </div>
  );
}
