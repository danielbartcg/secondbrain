"use client";

import { useEffect, useState } from "react";
import { Monitor, X } from "lucide-react";

/**
 * Invitation discrète « Télécharger l'app » (comme Slack, Notion…) : affichée
 * sur le site uniquement (pas dans l'application), sous Windows (seule
 * plateforme publiée), et masquable définitivement (mémorisé sur ce navigateur).
 */
const KEY = "sb:desktop-promo-dismissed";

export function DesktopAppPromo({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const inApp = !!window.secondBrain || !/^https?:$/.test(window.location.protocol);
    const windows = /Windows/i.test(navigator.userAgent);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {
      /* stockage indisponible : on affiche */
    }
    setShow(!inApp && windows && !dismissed);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignoré */
    }
  };

  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 ${className}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Monitor className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">Second Brain sur votre ordinateur</div>
        <div className="text-muted">Vos projets et cartes mentales, même sans connexion.</div>
      </div>
      <a href="/app" className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-700">
        Télécharger l&apos;app
      </a>
      <button type="button" onClick={dismiss} aria-label="Ne plus afficher" title="Ne plus afficher" className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
