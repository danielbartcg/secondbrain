"use client";

import type { LucideIcon } from "lucide-react";
import { parseIcon } from "@/lib/shared/icons";
import { LucideSvg, useIconData } from "./lucide-data";

/**
 * Icône d'un projet ou d'une carte mentale : icône de la bibliothèque Lucide
 * (données chargées à la demande), image personnalisée, ou icône par défaut
 * (`fallback`, aussi pendant le chargement). `className` règle la taille ;
 * la couleur suit `currentColor`.
 */
export function EntityIcon({ icon, fallback: Fallback, className = "h-5 w-5" }: { icon: string | null | undefined; fallback: LucideIcon; className?: string }) {
  const ref = parseIcon(icon);
  const data = useIconData();
  if (ref?.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={ref.url} alt="" aria-hidden className={`${className} shrink-0 rounded object-cover`} />;
  }
  if (ref?.kind === "lucide") {
    const nodes = data?.[ref.name];
    if (nodes) return <LucideSvg nodes={nodes} className={`${className} shrink-0`} />;
    return <Fallback className={`${className} shrink-0 ${data ? "" : "opacity-40"}`} aria-hidden />;
  }
  return <Fallback className={`${className} shrink-0`} aria-hidden />;
}
