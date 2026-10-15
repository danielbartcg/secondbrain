"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { AuthFrame, authButtonClass, authInputClass } from "@/components/AuthFrame";

/** Mot de passe oublié : envoie un lien de réinitialisation (si l'adresse correspond à un compte). */
function ForgotForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3 text-sm">
        <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">Si un compte existe avec l&apos;adresse {email}, un e-mail vient de lui être envoyé.</p>
        <p className="text-muted">Le lien est valable 1 heure. Pensez à regarder dans les courriers indésirables.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-2">E-mail du compte</span>
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInputClass} autoFocus />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy || !email.includes("@")} className={authButtonClass}>
        {busy ? "Envoi…" : "Recevoir un lien de réinitialisation"}
      </button>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthFrame title="Mot de passe oublié" subtitle="Recevez par e-mail un lien pour en choisir un nouveau.">
      <Suspense>
        <ForgotForm />
      </Suspense>
    </AuthFrame>
  );
}
