"use client";

import { Pin, PinOff } from "lucide-react";
import { togglePin, usePins } from "@/lib/pins-store";
import { toast } from "@/components/ui";

/** Épingler / désépingler un projet ou une carte dans le menu de gauche. */
export function PinButton({
  kind,
  item,
  className = "",
  withLabel = false,
}: {
  kind: "PROJECT" | "MINDMAP";
  item: { id: string; name: string; color?: string | null };
  className?: string;
  withLabel?: boolean;
}) {
  const pins = usePins();
  const pinned = (kind === "PROJECT" ? pins.projects : pins.mindmaps).some((x) => x.id === item.id);
  const label = pinned ? "Désépingler du menu" : "Épingler dans le menu";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePin(kind, item).catch((err) => toast(err instanceof Error ? err.message : "Épinglage impossible.", "error"));
      }}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      className={`inline-flex items-center gap-1.5 rounded-lg p-2 text-sm transition-colors md:p-1.5 ${pinned ? "text-brand-700 hover:bg-brand-50" : "text-muted hover:bg-surface-2 hover:text-ink"} ${className}`}
    >
      {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
      {withLabel && <span>{pinned ? "Épinglé" : "Épingler"}</span>}
    </button>
  );
}
