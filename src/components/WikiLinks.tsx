"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import LinkExtension from "@tiptap/extension-link";
import { api } from "@/lib/client";
import type { LinkTarget } from "@/lib/links";
import { LINK_KIND_COLOR, LINK_KIND_LABEL } from "@/lib/shared/links";

/**
 * Liens `[[…]]` de l'éditeur riche : taper `[[` ouvre une liste d'objets
 * (tâches, projets, nœuds, cartes, réunions, étapes, activités, documents)
 * filtrée au fil de la frappe ; Entrée / clic insère un lien interne
 * `<a href data-ref="kind:id">`. Les rétroliens et le graphe lisent
 * `data-ref` (src/lib/links.ts).
 */

/** Extension Link avec l'attribut `data-ref` (référence de l'objet lié). */
export const ObjectLink = LinkExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ref: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-ref"),
        renderHTML: (attrs: { ref?: string | null }) => (attrs.ref ? { "data-ref": attrs.ref } : {}),
      },
    };
  },
});

type Trigger = { from: number; to: number; query: string; x: number; y: number };

export function useWikiLinks(editor: Editor | null) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [items, setItems] = useState<LinkTarget[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const state = useRef({ trigger, items, active });
  state.current = { trigger, items, active };

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { selection } = editor.state;
      if (!selection.empty || !editor.isEditable) return setTrigger(null);
      const $from = selection.$from;
      if ($from.parent.type.spec.code) return setTrigger(null);
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 80), $from.parentOffset, undefined, "￼");
      const m = /\[\[([^[\]\n￼]{0,60})$/.exec(before);
      if (!m) return setTrigger(null);
      const from = $from.pos - m[0].length;
      const c = editor.view.coordsAtPos(from);
      setTrigger((t) => (t && t.from === from && t.query === m[1] ? t : { from, to: $from.pos, query: m[1], x: c.left, y: c.bottom }));
    };
    const blur = () => setTimeout(() => setTrigger(null), 200);
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    editor.on("blur", blur);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
      editor.off("blur", blur);
    };
  }, [editor]);

  const open = trigger !== null;
  const query = trigger?.query ?? "";
  useEffect(() => {
    if (!open) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ items: LinkTarget[] }>(`/links/suggest?q=${encodeURIComponent(query.trim())}`)
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setActive(0);
        })
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, query]);

  const choose = useCallback(
    (it: LinkTarget) => {
      const t = state.current.trigger;
      if (!editor || !t) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: t.from, to: t.to })
        .insertContent([
          { type: "text", text: it.title, marks: [{ type: "link", attrs: { href: it.href, ref: it.ref, target: null, rel: "noopener" } }] },
          { type: "text", text: " " },
        ])
        .run();
      setTrigger(null);
    },
    [editor],
  );

  /** À appeler depuis `handleKeyDown` de l'éditeur : true si la touche est consommée. */
  const onKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const { trigger: t, items: list, active: i } = state.current;
      if (!t) return false;
      if (event.key === "Escape") {
        setTrigger(null);
        return true;
      }
      if (!list.length) return false;
      if (event.key === "ArrowDown") {
        setActive((i + 1) % list.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setActive((i - 1 + list.length) % list.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        choose(list[i]);
        return true;
      }
      return false;
    },
    [choose],
  );

  const menu =
    trigger && typeof document !== "undefined"
      ? createPortal(
          <div
            role="listbox"
            aria-label="Lier un objet"
            className="fixed z-[80] w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
            style={{ left: Math.max(8, Math.min(trigger.x, (typeof window !== "undefined" ? window.innerWidth : 1000) - 328)), top: trigger.y + 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <p className="border-b border-line px-3 py-1.5 text-[11px] text-muted">
              Lier : <span className="font-medium text-ink-2">{trigger.query || "objets récents"}</span> · ↑ ↓ Entrée
            </p>
            {items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">{loading ? "Recherche…" : "Aucun objet trouvé (ou hors ligne)."}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {items.map((it, i) => (
                  <li key={it.ref} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onClick={() => choose(it)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-50" : ""}`}
                    >
                      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: LINK_KIND_COLOR[it.kind] }}>
                        {LINK_KIND_LABEL[it.kind]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{it.title}</span>
                        <span className="block truncate text-xs text-muted">{it.context}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )
      : null;

  return { menu, onKeyDown };
}
