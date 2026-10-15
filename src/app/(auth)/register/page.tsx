"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

const field =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("La confirmation ne correspond pas au mot de passe.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/register", { firstName, lastName, email, password, confirmPassword: confirm, client: "Web" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Inscription impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-on-brand">🧠</div>
          <h1 className="text-2xl font-semibold">Créer un compte</h1>
          <p className="mt-1 text-sm text-muted">Votre second cerveau commence ici.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-2">Prénom</span>
              <input required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-2">Nom</span>
              <input autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={field} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">E-mail</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">Mot de passe (8 caractères min.)</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
            <PasswordStrengthMeter password={password} personal={[email, firstName, lastName]} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">Confirmation du mot de passe</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={confirm.length > 0 && confirm !== password}
              className={`${field} ${confirm.length > 0 && confirm !== password ? "border-danger" : ""}`}
            />
            {confirm.length > 0 && confirm !== password && <span className="mt-1 block text-xs text-danger">La confirmation ne correspond pas.</span>}
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy || password.length < 8 || confirm !== password}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Création…" : "Créer mon compte"}
          </button>
          <p className="text-center text-sm text-muted">
            Déjà inscrit ?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
