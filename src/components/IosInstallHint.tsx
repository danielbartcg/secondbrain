"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone, SquarePlus, X } from "lucide-react";

/**
 * iPhone / iPad (Safari, site non installé) : invitation à ajouter Second
 * Brain à l'écran d'accueil (PWA plein écran). Masquée une fois installée
 * (`navigator.standalone`), dans l'application native, ou après fermeture
 * (mémorisé sur cet appareil).
 */
const KEY = "sb:ios-install-dismissed";

export function IosInstallHint({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    const inApp = !!window.secondBrain || !/^https?:$/.test(window.location.protocol);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {
      /* stockage indisponible : on affiche */
    }
    setShow(ios && !standalone && !inApp && !dismissed);
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
    <div className={`flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 ${className}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Smartphone className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">Second Brain sur votre écran d&apos;accueil</div>
        <div className="text-muted">
          Dans Safari, touchez <Share className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-label="Partager" /> puis « Sur l&apos;écran d&apos;accueil »{" "}
          <SquarePlus className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-hidden /> : l&apos;application s&apos;ouvre ensuite en plein écran.
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Ne plus afficher" title="Ne plus afficher" className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
