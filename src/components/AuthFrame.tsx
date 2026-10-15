import Link from "next/link";

/** Cadre des écrans publics de compte (mot de passe oublié, validation d'adresse…). */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/login" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-on-brand" aria-label="Second Brain — connexion">
            🧠
          </Link>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            ← Retour à la connexion
          </Link>
        </p>
      </div>
    </main>
  );
}

export const authInputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
export const authButtonClass = "w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700 disabled:opacity-60";
