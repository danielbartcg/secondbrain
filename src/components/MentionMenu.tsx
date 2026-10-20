"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Avatar } from "@/components/ui";

/**
 * Mentions « @ » dans l'éditeur riche (commentaires) : taper `@` puis le
 * début d'un nom ouvre la liste des membres ; ↑ ↓ Entrée / Tab insère
 * `@[Nom]` (forme lisible, le serveur résout l'identifiant du membre à
 * l'envoi, comme pour l'ancien champ texte).
 */

export type MentionCandidate = { id: string; name: string; color?: string | null; avatarUrl?: string | null };
type Trigger = { from: number; to: number; query: string; x: number; y: number };

export function useMentions(editor: Editor | null, members: MentionCandidate[] | undefined) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const enabled = !!members?.length;
  const q = (trigger?.query ?? "").toLowerCase();
  const items = trigger && members ? members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6) : [];
  const state = useRef({ trigger, items, active });
  state.current = { trigger, items, active };

  useEffect(() => {
    if (!editor || !enabled) return;
    const update = () => {
      const { selection } = editor.state;
      if (!selection.empty || !editor.isEditable) return setTrigger(null);
      const $from = selection.$from;
      if ($from.parent.type.spec.code) return setTrigger(null);
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, "￼");
      const m = /(^|\s)@([^\s@[\]￼]{0,30})$/.exec(before);
      if (!m) return setTrigger(null);
      const from = $from.pos - m[2].length - 1;
      const c = editor.view.coordsAtPos(from);
      setTrigger((t) => (t && t.from === from && t.query === m[2] ? t : { from, to: $from.pos, query: m[2], x: c.left, y: c.bottom }));
      setActive(0);
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
  }, [editor, enabled]);

  const choose = useCallback(
    (m: MentionCandidate) => {
      const t = state.current.trigger;
      if (!editor || !t) return;
      editor.chain().focus().deleteRange({ from: t.from, to: t.to }).insertContent(`@[${m.name}] `).run();
      setTrigger(null);
    },
    [editor],
  );

  /** À appeler depuis `handleKeyDown` : true si la touche est consommée. */
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
    trigger && items.length > 0 && typeof document !== "undefined"
      ? createPortal(
          <ul
            role="listbox"
            aria-label="Mentionner un membre"
            className="fixed z-[80] w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line-strong bg-surface py-1 shadow-xl"
            style={{ left: Math.max(8, Math.min(trigger.x, window.innerWidth - 296)), top: trigger.y + 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => choose(m)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-50" : ""}`}
                >
                  <Avatar id={m.id} name={m.name} color={m.color ?? undefined} src={m.avatarUrl ?? undefined} size={22} />
                  <span className="truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return { menu, onKeyDown };
}
