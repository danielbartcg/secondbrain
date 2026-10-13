import Link from "next/link";
import { NotebookPen } from "lucide-react";

/**
 * Aperçu des notes riches d'un objet (HTML **déjà assaini** côté serveur), avec
 * lien vers « Prise de notes » pour les modifier. Rendu serveur ou client.
 */
export function NotesPreview({ html, noteRef, title = "Notes", className = "" }: { html: string; noteRef: string; title?: string; className?: string }) {
  const empty = !html.includes("<img") && html.replace(/<[^>]+>/g, "").trim().length === 0;
  const editHref = `/notes?ref=${encodeURIComponent(noteRef)}`;
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <NotebookPen className="h-5 w-5 text-brand-600" /> {title}
        </h2>
        <Link href={editHref} className="ml-auto rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2">
          {empty ? "Prendre des notes" : "Modifier dans Prise de notes"}
        </Link>
      </div>
      {empty ? (
        <p className="mt-2 text-sm text-muted">Aucune note pour le moment.</p>
      ) : (
        // Contenu assaini par sanitizeNotes() à l'enregistrement et à la lecture.
        <div className="prose prose-sm mt-3 max-w-none text-ink-2" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </section>
  );
}
