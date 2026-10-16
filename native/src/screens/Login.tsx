import { useEffect, useState } from "react";
import type { Runtime } from "../local/runtime";

const DEFAULT_SERVER = "https://secondbrain.danielbar-tcg.fr";
const field = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/**
 * Connexion de l'application : adresse du serveur, e-mail, mot de passe.
 * Le jeton obtenu est conservé localement : l'application reste utilisable
 * hors ligne ensuite. Le premier instantané est téléchargé à la connexion.
 */
export function Login({ runtime, onDone, message }: { runtime: Runtime; onDone: () => void; message?: string }) {
  const [server, setServer] = useState(runtime.store.meta.serverUrl || (import.meta.env.DEV ? "http://localhost:3000" : DEFAULT_SERVER));
  const [email, setEmail] = useState(runtime.store.meta.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mêmes liens que la page de connexion du site, selon les options du serveur.
  const [options, setOptions] = useState<{ registration: boolean; passwordReset: boolean } | null>(null);
  const base = server.trim().replace(/\/+$/, "");
  useEffect(() => {
    setOptions(null);
    const bridge = typeof window !== "undefined" ? window.secondBrain : undefined;
    if (!/^https?:\/\/[^/]+$/.test(base)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let status: number;
        let body: string;
        if (bridge?.setServer) {
          // Electron : requête faite par le processus principal (origine annoncée d'abord).
          await bridge.setServer(base);
          ({ status, body } = await bridge.fetch({ url: `${base}/api/v1/auth/options`, method: "GET", headers: {} }));
        } else {
          // iPhone (réseau natif) et navigateur de développement (relais /__remote).
          const devProxy = (globalThis as { __SB_DEV_PROXY__?: boolean }).__SB_DEV_PROXY__ === true;
          const r = await fetch(devProxy ? "/__remote/api/v1/auth/options" : `${base}/api/v1/auth/options`);
          status = r.status;
          body = await r.text();
        }
        if (!cancelled && status === 200) setOptions(JSON.parse(body));
      } catch {
        /* serveur injoignable : liens masqués */
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [base]);
  /** Page du site, dans le navigateur du système (Electron) ou un nouvel onglet / Safari. */
  const openSite = (path: string) => {
    const url = `${base}${path}`;
    if (window.secondBrain?.openExternal) void window.secondBrain.openExternal(url);
    else window.open(url, "_blank", "noopener");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await runtime.signIn(server, email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-on-brand">🧠</div>
          <h1 className="text-2xl font-semibold">Second Brain</h1>
          <p className="mt-1 text-sm text-muted">Connectez-vous une fois : vos projets et cartes restent ensuite disponibles hors ligne.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          {message && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">Serveur</span>
            <input required type="url" value={server} onChange={(e) => setServer(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">E-mail</span>
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-sm font-medium text-ink-2">
              Mot de passe
              {options?.passwordReset && (
                <button type="button" onClick={() => openSite(`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`)} className="text-xs font-medium text-brand-600 hover:underline">
                  Mot de passe oublié ?
                </button>
              )}
            </span>
            <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700 disabled:opacity-60">
            {busy ? "Connexion et téléchargement…" : "Se connecter"}
          </button>
          {options?.registration && (
            <p className="text-center text-sm text-muted">
              Pas encore de compte ?{" "}
              <button type="button" onClick={() => openSite("/register")} className="font-medium text-brand-600 hover:underline">
                Créer un compte
              </button>
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
