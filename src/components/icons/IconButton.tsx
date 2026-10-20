"use client";

import { Suspense, lazy, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { EntityIcon } from "./EntityIcon";

const IconPicker = lazy(() => import("./IconPicker").then((m) => ({ default: m.IconPicker })));

/**
 * Pastille d'icône d'un projet / d'une carte. `onChange` fourni (droit
 * d'écriture) : un clic ouvre la bibliothèque (`IconPicker`, chargé à la
 * demande). `boxClassName` : la pastille (taille, fond, couleur du texte).
 */
export function IconButton({
  icon,
  fallback,
  title,
  onChange,
  boxClassName,
  iconClassName = "h-5 w-5",
  style,
}: {
  icon: string | null | undefined;
  fallback: LucideIcon;
  title: string;
  onChange?: (icon: string | null) => void | Promise<void>;
  boxClassName: string;
  iconClassName?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const inner = <EntityIcon icon={icon} fallback={fallback} className={iconClassName} />;
  if (!onChange)
    return (
      <span className={boxClassName} style={style}>
        {inner}
      </span>
    );
  return (
    <>
      <button
        type="button"
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`${boxClassName} transition hover:ring-2 hover:ring-brand-500 hover:ring-offset-1`}
        style={style}
        title="Choisir une icône"
        aria-label={`Choisir l'icône de « ${title} »`}
      >
        {inner}
      </button>
      {open && (
        <Suspense fallback={null}>
          <IconPicker
            value={icon ?? null}
            title={title}
            onClose={() => setOpen(false)}
            onPick={(v) => {
              setOpen(false);
              void onChange(v);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
