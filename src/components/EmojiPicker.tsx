"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

/**
 * Bouton « Emoji » + sélecteur (emoji-mart, chargé à la première ouverture).
 * Données et traductions françaises embarquées : aucun appel à un CDN
 * (compatible CSP et hors ligne dans l'application native). Emoji natifs du
 * système (pas d'images).
 */

type PickerModule = typeof import("emoji-mart");
let loader: Promise<{ mod: PickerModule; data: unknown; i18n: unknown }> | null = null;

function load() {
  loader ??= Promise.all([import("emoji-mart"), import("@emoji-mart/data"), import("@emoji-mart/data/i18n/fr.json")]).then(([mod, data, i18n]) => ({
    mod,
    data: (data as { default?: unknown }).default ?? data,
    i18n: (i18n as { default?: unknown }).default ?? i18n,
  }));
  return loader;
}

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function EmojiButton({
  onSelect,
  className = "",
  title = "Insérer un emoji",
  align = "left",
}: {
  onSelect: (emoji: string) => void;
  className?: string;
  title?: string;
  /** Ouverture vers la droite (left) ou la gauche (right) du bouton, sur grand écran. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const host = hostRef.current;
    void load().then(({ mod, data, i18n }) => {
      if (cancelled || !host) return;
      host.replaceChildren();
      const picker = new mod.Picker({
        data,
        i18n,
        locale: "fr",
        set: "native",
        theme: currentTheme(),
        previewPosition: "none",
        skinTonePosition: "search",
        autoFocus: true,
        maxFrequentRows: 2,
        onEmojiSelect: (e: { native: string }) => {
          onSelectRef.current(e.native);
          setOpen(false);
        },
      });
      host.appendChild(picker as unknown as Node);
    });
    const onDown = (e: MouseEvent) => {
      // Le sélecteur est un web component (shadow DOM) : composedPath couvre ses éléments internes.
      if (wrapRef.current && !e.composedPath().includes(wrapRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        // Ne pas voler le focus (et la sélection) de l'éditeur.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={className || "rounded p-2 text-muted hover:bg-surface-2 hover:text-ink"}
      >
        <Smile className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choisir un emoji"
          className={`fixed inset-x-0 bottom-0 z-50 flex justify-center sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-1 ${align === "right" ? "sm:right-0" : "sm:left-0"}`}
        >
          <div ref={hostRef} className="min-h-[200px] min-w-[300px] rounded-xl bg-surface shadow-xl">
            <div className="p-4 text-sm text-muted">Chargement…</div>
          </div>
        </div>
      )}
    </div>
  );
}
