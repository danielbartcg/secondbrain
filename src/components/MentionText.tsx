"use client";

import { mentionSegments } from "@/lib/shared/mentions";

/**
 * Texte d'une piste d'audit, d'une notification ou d'un extrait de
 * commentaire : les mentions `@[Nom](id)` s'affichent en pastille « @Nom »,
 * comme dans le fil de commentaires (jamais l'identifiant).
 */
export function MentionText({ text }: { text: string }) {
  const parts = mentionSegments(text);
  if (parts.length === 1 && parts[0].kind === "text") return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700">
            @{p.name}
          </span>
        ),
      )}
    </>
  );
}
