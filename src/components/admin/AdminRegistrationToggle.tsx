"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/client";
import { Toggle, toast } from "@/components/ui";
import type { RegistrationSettingsDto } from "@/lib/settings";

/** Administration → Utilisateurs : ouvrir / fermer les inscriptions libres (page « Créer un compte »). */
export function AdminRegistrationToggle({ initial }: { initial: RegistrationSettingsDto }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function change(v: boolean) {
    setBusy(true);
    const before = settings;
    setSettings({ ...settings, enabled: v, open: v && !settings.forcedClosed });
    try {
      const r = await api.patch<{ registration: RegistrationSettingsDto }>("/admin/settings", { registrationEnabled: v });
      setSettings(r.registration);
      toast(v ? "Inscriptions ouvertes." : "Inscriptions fermées : seuls les administrateurs créent des comptes.", "ok");
    } catch (e) {
      setSettings(before);
      toast(e instanceof Error ? e.message : "Enregistrement impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5 flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-surface p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <UserPlus className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Inscriptions libres</h2>
        <p className="text-sm text-muted">
          {settings.open
            ? "Tout le monde peut créer un compte depuis la page de connexion."
            : "Fermées : le lien « Créer un compte » est masqué ; seuls les administrateurs créent des comptes."}
          {settings.forcedClosed && " La variable d'environnement ALLOW_REGISTRATION=false les ferme côté serveur, quel que soit ce réglage."}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        {settings.enabled ? "Ouvertes" : "Fermées"}
        <Toggle checked={settings.enabled} onChange={(v) => void change(v)} disabled={busy} label="Autoriser la création de comptes depuis la page de connexion" />
      </label>
    </section>
  );
}
