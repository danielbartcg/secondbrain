import { Loader2 } from "lucide-react";

/** Chargement d'une page de l'application (la coque reste affichée). */
export default function AppLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24 text-muted" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
