"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, KeyRound, Loader2, Monitor, Palette, Trash2, UserRound } from "lucide-react";
import { ApiClientError, api, uploadImage } from "@/lib/client";
import type { ProfileDto, Theme } from "@/lib/users";
import { Avatar, Button, PageHeader, inputClass } from "@/components/ui";
import { ConnectorSection, EmailSection } from "@/components/preferences/AccountSections";

/**
 * Préférences personnelles : prénom et nom (nom affiché partout à la place de
 * l'e-mail), photo de profil (sinon silhouette), adresse e-mail (validation,
 * changement, notifications par e-mail), mot de passe, application desktop,
 * connecteur Claude (clés MCP), thème d'affichage.
 */

const THEME_OPTIONS: Array<{ key: Theme; label: string; swatch: [string, string, string] }> = [
  { key: "light", label: "Clair", swatch: ["#f6f5f2", "#ffffff", "#3f4ee0"] },
  { key: "dark", label: "Sombre", swatch: ["#111318", "#1a1d24", "#6674f5"] },
  { key: "sepia", label: "Sépia", swatch: ["#f4ecd8", "#fbf6ea", "#9a5f24"] },
  { key: "ocean", label: "Océan", swatch: ["#eef4f8", "#ffffff", "#0284c7"] },
  { key: "forest", label: "Forêt", swatch: ["#f1f4ee", "#ffffff", "#23854a"] },
];

export function PreferencesPage({ initial }: { initial: ProfileDto }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [savingName, setSavingName] = useState(false);
  const [savedName, setSavedName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(data: Record<string, unknown>) {
    setError(null);
    const { profile } = await api.patch<{ profile: ProfileDto }>("/me", data);
    setProfile(profile);
    router.refresh(); // met à jour la coque (nom, photo)
    return profile;
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      await save({ firstName, lastName });
      setSavedName(true);
      setTimeout(() => setSavedName(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSavingName(false);
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      if (!url) throw new Error("Image refusée (JPEG, PNG, GIF ou WebP, 10 Mo max).");
      await save({ avatarUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Téléversement impossible.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    if (!window.confirm("Retirer votre photo de profil ?")) return;
    try {
      await save({ avatarUrl: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression de la photo impossible.");
    }
  }

  async function chooseTheme(theme: Theme) {
    // Application immédiate, puis enregistrement ; retour au thème précédent en cas d'échec.
    const previous = profile.theme;
    setThemeError(null);
    document.documentElement.dataset.theme = theme;
    setProfile((p) => ({ ...p, theme }));
    try {
      await save({ theme });
    } catch (err) {
      document.documentElement.dataset.theme = previous;
      setProfile((p) => ({ ...p, theme: previous }));
      setThemeError(err instanceof Error ? err.message : "Enregistrement du thème impossible.");
    }
  }

  const dirty = firstName !== profile.firstName || lastName !== profile.lastName;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader title="Préférences" subtitle="Votre identité dans l'application et l'apparence de l'interface." />
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Identité */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <UserRound className="h-5 w-5 text-brand-600" /> Identité
        </h2>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <Avatar id={profile.id} name={profile.name} src={profile.avatarUrl} size={96} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} {profile.avatarUrl ? "Changer" : "Ajouter une photo"}
              </Button>
              {profile.avatarUrl && (
                <Button size="sm" variant="danger" onClick={() => void removePhoto()} title="Retirer la photo" aria-label="Retirer la photo">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <form onSubmit={saveName} className="min-w-0 flex-1 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Prénom</span>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} autoComplete="given-name" className={`${inputClass} w-full`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Nom</span>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} autoComplete="family-name" className={`${inputClass} w-full`} />
              </label>
            </div>
            <p className="text-xs text-muted">
              Nom affiché : <strong className="text-ink">{`${firstName.trim()} ${lastName.trim()}`.trim() || profile.email}</strong> — c&apos;est ce nom qui apparaît dans les équipes, les commentaires et les
              notifications.
            </p>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!dirty || savingName || (!firstName.trim() && !lastName.trim())}>
                {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer
              </Button>
              {savedName && <span className="text-xs text-ok">Enregistré</span>}
            </div>
            <dl className="grid gap-1 border-t border-line pt-3 text-xs text-muted sm:grid-cols-2">
              <div>
                <dt className="inline">Identifiant : </dt>
                <dd className="inline text-ink-2">{profile.email}</dd>
              </div>
              <div>
                <dt className="inline">Rôle : </dt>
                <dd className="inline text-ink-2">{profile.isSuperAdmin ? "Super administrateur" : profile.isAdmin ? "Administrateur" : "Utilisateur"}</dd>
              </div>
            </dl>
          </form>
        </div>
      </section>

      {/* Adresse e-mail et notifications par e-mail */}
      <EmailSection profile={profile} onProfile={setProfile} />

      {/* Mot de passe */}
      <PasswordSection />

      {/* Application desktop */}
      <DesktopSection />

      {/* Connecteur Claude (MCP) */}
      <ConnectorSection />

      {/* Thème */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Palette className="h-5 w-5 text-brand-600" /> Thème
        </h2>
        <p className="mt-1 text-sm text-muted">Appliqué immédiatement et mémorisé sur votre compte (tous vos appareils).</p>
        {themeError && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
            {themeError}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {THEME_OPTIONS.map((t) => {
            const active = profile.theme === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => void chooseTheme(t.key)}
                aria-pressed={active}
                className={`overflow-hidden rounded-xl border text-left transition-shadow hover:shadow-md ${active ? "border-brand-500 ring-2 ring-brand-500" : "border-line"}`}
              >
                <span className="flex h-16 items-end gap-1 p-2" style={{ backgroundColor: t.swatch[0] }}>
                  <span className="h-10 flex-1 rounded-md" style={{ backgroundColor: t.swatch[1], boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }} />
                  <span className="h-6 w-4 rounded" style={{ backgroundColor: t.swatch[2] }} />
                </span>
                <span className="flex items-center justify-between px-2.5 py-1.5 text-sm font-medium">
                  {t.label}
                  {active && <Check className="h-4 w-4 text-brand-600" />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Changement de mot de passe : actuel, nouveau, confirmation. Les autres sessions sont fermées. */
function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;
  const same = next.length > 0 && next === current;
  const canSubmit = current.length > 0 && next.length >= 8 && confirm === next && !same && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/me/password", { currentPassword: current, newPassword: next, confirmPassword: confirm });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Mot de passe modifié. Vos autres sessions (autres appareils) ont été déconnectées." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : "Modification impossible." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-5 w-5 text-brand-600" /> Mot de passe
      </h2>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block sm:max-w-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Mot de passe actuel</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={`${inputClass} w-full`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Nouveau mot de passe (8 caractères min.)</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={`${inputClass} w-full ${tooShort || same ? "border-danger" : ""}`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Confirmation</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputClass} w-full ${mismatch ? "border-danger" : ""}`} />
          </label>
        </div>
        {(tooShort || mismatch || same) && (
          <p className="text-xs text-danger">
            {tooShort ? "Le nouveau mot de passe doit faire au moins 8 caractères. " : ""}
            {same ? "Le nouveau mot de passe doit être différent de l'actuel. " : ""}
            {mismatch ? "La confirmation ne correspond pas." : ""}
          </p>
        )}
        {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-danger"}`}>{message.text}</p>}
        <Button type="submit" disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Changer le mot de passe
        </Button>
      </form>
    </section>
  );
}

/** Application desktop : lien de téléchargement (site) ou version installée (application). */
function DesktopSection() {
  const [desktop, setDesktop] = useState<{ version: string } | null>(null);
  useEffect(() => {
    if (window.secondBrain) setDesktop({ version: window.secondBrain.version });
  }, []);
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Monitor className="h-5 w-5 text-brand-600" /> Application desktop
      </h2>
      {desktop ? (
        <p className="mt-1 text-sm text-muted">Vous utilisez l'application desktop, version {desktop.version}. Vos projets et cartes restent disponibles hors ligne.</p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Projets et cartes mentales disponibles hors ligne, synchronisés automatiquement :{" "}
          <a href="/app" className="font-medium text-brand-700 hover:underline">
            télécharger l'application pour Windows
          </a>
          .
        </p>
      )}
    </section>
  );
}
