"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Erreur inattendue dans une page de l'application (la coque reste affichée). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-danger">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Une erreur est survenue</h1>
      <p className="mt-2 text-sm text-muted">La page n&apos;a pas pu s&apos;afficher. Réessayez ; si le problème persiste, revenez au tableau de bord.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-700"
        >
          Réessayer
        </button>
        <Link href="/dashboard" className="inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2">
          Tableau de bord
        </Link>
      </div>
    </div>
  );
}
