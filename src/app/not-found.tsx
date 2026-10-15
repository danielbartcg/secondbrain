import Link from "next/link";

export const metadata = { title: "Page introuvable" };

/** 404 globale : jetons du thème, retour au tableau de bord. */
export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-1 items-center justify-center px-4 py-10 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Erreur 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page introuvable</h1>
        <p className="mt-2 text-sm text-muted">Cette page n&apos;existe pas, a été déplacée ou vous n&apos;y avez pas accès.</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-700"
        >
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
