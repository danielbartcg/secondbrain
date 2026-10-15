"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { uploadImage } from "@/lib/client";
import { EmojiButton } from "@/components/EmojiPicker";

/**
 * Éditeur WYSIWYG des notes (repris du template boutique).
 *
 * Collage / glisser-déposer d'images SANS latence perçue : l'image est
 * insérée immédiatement avec une URL blob locale (aperçu instantané),
 * l'upload part en arrière-plan, puis le nœud est mis à jour avec l'URL
 * serveur définitive. En cas d'échec d'upload, le nœud est retiré.
 *
 * `onChange` n'est appelé qu'avec du HTML sans URL blob : tant qu'un upload
 * est en cours, la sauvegarde est différée (une URL blob persistée serait
 * cassée partout ailleurs).
 *
 * Emoji : bouton de la barre d'outils (sélecteur emoji-mart).
 * `variant="compact"` (messagerie) : barre réduite ; `onSubmit` est appelé par
 * Ctrl/⌘ + Entrée.
 */

/** Remplace (ou retire) le nœud image dont le src correspond à `blobUrl`. */
function replaceImageSrc(editor: Editor, blobUrl: string, serverUrl: string | null) {
  const { state, view } = editor;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "image" || node.attrs.src !== blobUrl) return true;
    const tr = serverUrl
      ? state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: serverUrl })
      : state.tr.delete(pos, pos + node.nodeSize);
    view.dispatch(tr);
    return false;
  });
  URL.revokeObjectURL(blobUrl);
}

/** Insertion optimiste : aperçu blob immédiat, upload en arrière-plan. */
export function insertImageFiles(editor: Editor, files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const blobUrl = URL.createObjectURL(file);
    editor.chain().focus().setImage({ src: blobUrl }).run();
    void uploadImage(file)
      .then((serverUrl) => replaceImageSrc(editor, blobUrl, serverUrl))
      .catch(() => replaceImageSrc(editor, blobUrl, null));
  }
}

function hasPendingUploads(html: string): boolean {
  return html.includes('src="blob:');
}

export function RichTextEditor({
  initialHtml,
  onChange,
  placeholder = "Vos notes… Collez directement vos images dans le texte.",
  minHeight = 240,
  /** Change quand on passe à un autre document : recharge le contenu. */
  documentKey,
  variant = "full",
  onSubmit,
  autoFocus = false,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  documentKey?: string;
  variant?: "full" | "compact";
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const compact = variant === "compact";

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialHtml,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (!hasPendingUploads(html)) onChangeRef.current(html);
    },
    editorProps: {
      // 16 px minimum sur mobile : évite le zoom automatique d'iOS à la saisie.
      attributes: { class: "prose max-w-none", "aria-label": placeholder },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (files && files.length > 0 && editor) {
          event.preventDefault();
          insertImageFiles(editor, files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0 && editor) {
          event.preventDefault();
          insertImageFiles(editor, files);
          return true;
        }
        return false;
      },
    },
  });

  // Changement de document (autre nœud sélectionné) : on recharge le contenu
  // sans déclencher onChange.
  const lastKey = useRef(documentKey);
  useEffect(() => {
    if (!editor || lastKey.current === documentKey) return;
    lastKey.current = documentKey;
    editor.commands.setContent(initialHtml, false);
    if (autoFocus) editor.commands.focus("end");
  }, [documentKey, initialHtml, editor, autoFocus]);

  const emoji = editor ? (
    <EmojiButton
      onSelect={(e) => editor.chain().focus().insertContent(e).run()}
      className="rounded bg-surface px-2.5 py-1 text-ink-2 ring-1 ring-line hover:bg-surface-3"
    />
  ) : null;

  if (compact) {
    return (
      <div className="editor-compact rounded-lg border border-line-strong bg-surface focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <div style={{ ["--editor-min-height" as string]: `${minHeight}px` }} className="max-h-60 overflow-y-auto px-1">
          <EditorContent editor={editor} />
        </div>
        {editor && (
          <div className="flex flex-wrap items-center gap-1 border-t border-line p-1">
            <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="G" title="Gras" className="font-bold" />
            <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="I" title="Italique" className="italic" />
            <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label="• Liste" title="Liste à puces" />
            {emoji}
            <ToolbarButton onClick={() => fileInputRef.current?.click()} active={false} label="🖼" title="Insérer une image (ou collez-la directement dans le texte)" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && editor) insertImageFiles(editor, e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg focus-within:ring-2 focus-within:ring-brand-100">
      {editor && (
        <div className="flex flex-wrap gap-1 rounded-t-lg border border-line-strong bg-surface-2 p-1.5" role="toolbar" aria-label="Mise en forme">
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="G" title="Gras" className="font-bold" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="I" title="Italique" className="italic" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} label="S" title="Barré" className="line-through" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} label="H2" title="Titre" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} label="H3" title="Sous-titre" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label="• Liste" title="Liste à puces" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} label="1. Liste" title="Liste numérotée" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} label="☑ Tâches" title="Liste de cases à cocher" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label="❝" title="Citation" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} label="</>" title="Bloc de code" />
          <ToolbarButton
            onClick={() => {
              const url = prompt("URL du lien :", editor.getAttributes("link").href ?? "https://");
              if (url === null) return;
              if (url === "") editor.chain().focus().unsetLink().run();
              else editor.chain().focus().setLink({ href: url }).run();
            }}
            active={editor.isActive("link")}
            label="Lien"
            title="Insérer un lien"
          />
          {emoji}
          <ToolbarButton onClick={() => fileInputRef.current?.click()} active={false} label="🖼 Image" title="Insérer une image (ou collez-la directement dans le texte)" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && editor) insertImageFiles(editor, e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}
      <div style={{ ["--editor-min-height" as string]: `${minHeight}px` }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  label,
  title,
  className = "",
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded px-2.5 py-1 text-xs font-medium sm:text-sm ${
        active ? "bg-brand-600 text-on-brand" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-surface-3"
      } ${className}`}
    >
      {label}
    </button>
  );
}
