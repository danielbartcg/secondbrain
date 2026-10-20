"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { editorHtml } from "@/lib/shared/rich-text";

/**
 * Description riche d'une tâche : éditeur compact (gras, italique, listes,
 * emoji, images collées) enregistré automatiquement (800 ms après la
 * dernière frappe, et en quittant). Les anciennes descriptions en texte brut
 * sont converties en paragraphes. `editable={false}` : consultation seule.
 */
export function RichDescription({
  value,
  onSave,
  editable = true,
  documentKey,
  placeholder = "Décrire la tâche, le résultat attendu, les points d'attention…",
  minHeight = 72,
}: {
  value: string;
  onSave: (html: string) => Promise<unknown> | void;
  editable?: boolean;
  documentKey: string;
  placeholder?: string;
  minHeight?: number;
}) {
  const initial = editorHtml(value);
  const last = useRef(initial);
  const draft = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "saved">("idle");
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const html = draft.current;
    draft.current = null;
    if (html === null) return;
    const clean = html === "<p></p>" ? "" : html;
    if (clean === last.current) return setState("idle");
    last.current = clean;
    await saveRef.current(clean);
    setState("saved");
  }, []);

  useEffect(() => () => void flush(), [flush, documentKey]);
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  if (!editable && !initial) return <p className="text-sm text-muted">Aucune description.</p>;

  return (
    <div className="relative">
      <RichTextEditor
        initialHtml={initial}
        documentKey={documentKey}
        variant="compact"
        minHeight={minHeight}
        editable={editable}
        placeholder={placeholder}
        onChange={(html) => {
          draft.current = html;
          setState("pending");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), 800);
        }}
      />
      {editable && state !== "idle" && (
        <span className="pointer-events-none absolute right-2 top-1.5 text-[11px] text-muted" aria-live="polite">
          {state === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Enregistrement…" /> : <Check className="h-3.5 w-3.5 text-ok" aria-label="Enregistré" />}
        </span>
      )}
    </div>
  );
}
