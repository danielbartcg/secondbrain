"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { AuthFrame, authButtonClass, authInputClass } from "@/components/AuthFrame";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

/** Choix d'un nouveau mot de passe depuis le lien reçu par e-mail. */
function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password, confirmPassword: confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Réinitialisation impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <p className="text-sm text-danger">Lien incomplet : ouvrez le lien reçu par e-mail tel quel.</p>;
  if (done) {
    return (
      <div className="space-y-4 text-sm">
        <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">Mot de passe modifié. Vos sessions ouvertes ont été fermées par sécurité.</p>
        <Link href="/login" className={`${authButtonClass} block text-center`}>
          Se connecter
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-2">Nouveau mot de passe (8 caractères min.)</span>
        <input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} autoFocus />
        <PasswordStrengthMeter password={password} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-2">Confirmation</span>
        <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${authInputClass} ${mismatch ? "border-danger" : ""}`} />
      </label>
      {mismatch && <p className="text-xs text-danger">La confirmation ne correspond pas.</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {error}{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Nouvelle demande
          </Link>
        </p>
      )}
      <button type="submit" disabled={busy || password.length < 8 || mismatch || !confirm} className={authButtonClass}>
        {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthFrame title="Nouveau mot de passe">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
