"use client";

import { Suspense, useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";

/** Destination après connexion : chemin de **notre** origine uniquement (pas de redirection ouverte). */
function safeNext(value: string | null): string {
  const fallback = "/dashboard";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Options publiques : inscription ouverte, réinitialisation par e-mail disponible. */
  const [options, setOptions] = useState<{ registration: boolean; passwordReset: boolean } | null>(null);

  useEffect(() => {
    api
      .get<{ registration: boolean; passwordReset: boolean }>("/auth/options")
      .then(setOptions)
      .catch(() => setOptions(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password, client: "Web" });
      router.push(safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-2">E-mail</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-ink-2">
          Mot de passe
          {options?.passwordReset && (
            <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-xs font-medium text-brand-600 hover:underline">
              Mot de passe oublié ?
            </Link>
          )}
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? "Connexion…" : "Se connecter"}
      </button>
      {options?.registration !== false && (
        <p className="text-center text-sm text-muted">
          Pas encore de compte ?{" "}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Créer un compte
          </Link>
        </p>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-on-brand">🧠</div>
          <h1 className="text-2xl font-semibold">Second Brain</h1>
          <p className="mt-1 text-sm text-muted">Cartes mentales et projets, au même endroit.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <a href="/app" className="mt-4 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink">
          <Monitor className="h-4 w-4" /> Applications Windows et iPhone <span aria-hidden>→</span>
        </a>
      </div>
    </main>
  );
}
