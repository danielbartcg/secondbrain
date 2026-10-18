"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Brain, ChevronDown, ChevronRight, ExternalLink, FolderKanban, Inbox, Layers, ListChecks, ListTodo, Loader2, NotebookPen, PanelLeft, Workflow, X } from "lucide-react";
import { api } from "@/lib/client";
import type { NoteDocument, NoteKind, TreeItem } from "@/lib/notes";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Backlinks } from "@/components/Backlinks";
import { toast } from "@/components/ui";

/**
 * « Prise de notes » : à gauche, l'arborescence de tous les objets (cartes
 * mentales › carte › nœuds… ; projets › projet › étapes › activités › tâches),
 * chargée **de proche en proche** à l'ouverture de chaque branche ; à droite,
 * un grand document de notes riches façon Notion pour l'objet sélectionné
 * (enregistrement automatique différé). Sur mobile, l'arborescence est un
 * tiroir. Lien profond : `/notes?ref=kind:id`.
 */

const KIND_ICON: Record<NoteKind, typeof Brain> = {
  root: NotebookPen,
  section: FolderKanban,
  mindmap: Brain,
  node: Workflow,
  project: FolderKanban,
  stage: Layers,
  activity: ListChecks,
  task: ListTodo,
};
const KIND_LABEL: Record<NoteKind, string> = { root: "", section: "Section", mindmap: "Carte mentale", node: "Nœud", project: "Projet", stage: "Étape", activity: "Activité", task: "Tâche" };

function ItemIcon({ item, className = "h-4 w-4" }: { item: Pick<TreeItem, "kind" | "id" | "color">; className?: string }) {
  const Icon = item.kind === "section" && item.id === "orphans" ? Inbox : KIND_ICON[item.kind];
  return <Icon className={`${className} shrink-0`} style={item.color ? { color: item.color } : undefined} />;
}

type TreeState = Record<string, { items: TreeItem[] | null; loading: boolean; open: boolean; error?: boolean }>;

export function NotesWorkspace({ roots }: { roots: TreeItem[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const initialRef = params.get("ref");
  const [tree, setTree] = useState<TreeState>({ root: { items: roots, loading: false, open: true } });
  const [current, setCurrent] = useState<string | null>(initialRef);
  const [doc, setDoc] = useState<NoteDocument | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(false);
  const [docTick, setDocTick] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHtml = useRef<string | null>(null);

  /** Charge (une fois) les enfants d'une branche et l'ouvre. */
  const load = useCallback(async (ref: string) => {
    setTree((t) => ({ ...t, [ref]: { items: t[ref]?.items ?? null, loading: true, open: true } }));
    try {
      const { children } = await api.get<{ children: TreeItem[] }>(`/notes/tree?parent=${encodeURIComponent(ref)}`);
      setTree((t) => ({ ...t, [ref]: { items: children, loading: false, open: true } }));
    } catch {
      // items reste nul : un nouveau clic sur la branche relance le chargement.
      setTree((t) => ({ ...t, [ref]: { items: null, loading: false, open: true, error: true } }));
    }
  }, []);

  const toggle = (ref: string) => {
    const s = tree[ref];
    if (!s || s.items === null) void load(ref);
    else setTree((t) => ({ ...t, [ref]: { ...s, open: !s.open } }));
  };

  /** Envoie les notes en attente (immédiatement) ; `false` si l'enregistrement a échoué. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const html = pendingHtml.current;
    const ref = current;
    if (html === null || !ref) return true;
    pendingHtml.current = null;
    setSaving("saving");
    try {
      const { document } = await api.patch<{ document: NoteDocument }>(`/notes/${ref.replace(":", "/")}`, { notes: html });
      setSaving("idle");
      // Met à jour l'indicateur « a des notes » dans l'arbre.
      const has = document.notes.includes("<img") || document.notes.replace(/<[^>]+>/g, "").trim().length > 0;
      setTree((t) => {
        const next: TreeState = {};
        for (const [k, v] of Object.entries(t)) next[k] = { ...v, items: v.items?.map((i) => (i.ref === ref ? { ...i, hasNotes: has } : i)) ?? null };
        return next;
      });
      return true;
    } catch {
      // On conserve le texte non enregistré (sauf saisie plus récente) pour réessayer.
      if (pendingHtml.current === null) pendingHtml.current = html;
      setSaving("error");
      return false;
    }
  }, [current]);

  const onChange = (html: string) => {
    pendingHtml.current = html;
    setSaving("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 800);
  };

  // Sélection d'un élément : enregistre le précédent, charge le document, ouvre les parents.
  useEffect(() => {
    if (!current) {
      setDoc(null);
      return;
    }
    let alive = true;
    setDocLoading(true);
    setDocError(false);
    api
      .get<{ document: NoteDocument }>(`/notes/${current.replace(":", "/")}`)
      .then(({ document }) => {
        if (!alive) return;
        setDoc(document);
        // Déplie le chemin dans l'arbre (chargement de proche en proche).
        for (const crumb of document.breadcrumb) if (!tree[crumb.ref]?.items) void load(crumb.ref);
        if (document.breadcrumb.length === 0 && document.kind !== "root" && document.kind !== "section") void load(document.kind === "mindmap" ? "section:mindmaps" : "section:projects");
      })
      .catch(() => {
        if (!alive) return;
        setDoc(null);
        setDocError(true);
      })
      .finally(() => alive && setDocLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, docTick]);

  // Enregistre avant de quitter la page.
  useEffect(() => {
    const onLeave = () => {
      if (pendingHtml.current !== null && current) {
        // Application (app://, capacitor://) : API locale, enregistrée dans la base hors ligne.
        if (!/^https?:$/.test(window.location.protocol)) {
          void api.patch(`/notes/${current.replace(":", "/")}`, { notes: pendingHtml.current });
          return;
        }
        void fetch(`/api/v1/notes/${current.replace(":", "/")}`, {
          method: "PATCH",
          keepalive: true,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: pendingHtml.current }),
        });
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [current]);

  const select = async (ref: string) => {
    if (ref === current) return;
    if (!(await flush())) {
      toast("Vos dernières notes n'ont pas pu être enregistrées : réessayez avant de changer d'élément.", "error");
      return;
    }
    setSaving("idle");
    setCurrent(ref);
    setDrawer(false);
    router.replace(`/notes?ref=${encodeURIComponent(ref)}`, { scroll: false });
  };

  const renderItems = (parentRef: string, depth: number): React.ReactNode => {
    const s = tree[parentRef];
    if (!s?.items) return null;
    return (
      <ul className={depth > 0 ? "ml-3 border-l border-line pl-1" : ""}>
        {s.items.map((item) => {
          const st = tree[item.ref];
          const open = st?.open ?? false;
          const active = item.ref === current;
          return (
            <li key={item.ref}>
              <div className={`group flex items-center gap-1 rounded-lg pr-1 ${active ? "bg-brand-50 text-brand-700" : "hover:bg-surface-2"}`}>
                <button
                  type="button"
                  onClick={() => toggle(item.ref)}
                  disabled={!item.hasChildren}
                  className={`flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted ${item.hasChildren ? "hover:bg-surface-3" : "opacity-0"}`}
                  aria-label={open ? "Replier" : "Déplier"}
                >
                  {st?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => void select(item.ref)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm" title={`${KIND_LABEL[item.kind]} : ${item.title}`}>
                  <ItemIcon item={item} className={item.kind === "section" ? "h-4 w-4 text-ink-2" : "h-4 w-4 text-muted"} />
                  <span className={`truncate ${item.kind === "section" ? "font-semibold" : ""}`}>{item.title}</span>
                  {item.hasNotes && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" title="Contient des notes" />}
                  {item.hint && <span className="ml-auto shrink-0 text-[11px] text-faint">{item.hint}</span>}
                </button>
              </div>
              {open && renderItems(item.ref, depth + 1)}
              {open && st?.items?.length === 0 && !st.loading && <p className="ml-9 py-1 text-xs text-faint">Vide</p>}
              {open && st?.error && !st.items && !st.loading && (
                <p className="ml-9 py-1 text-xs text-danger">
                  Chargement impossible.{" "}
                  <button type="button" onClick={() => void load(item.ref)} className="underline hover:text-ink">
                    Réessayer
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  // Tiroir mobile : Échap le ferme.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const treePanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <NotebookPen className="h-5 w-5 text-brand-600" />
        <span className="font-semibold">Prise de notes</span>
        <button type="button" onClick={() => setDrawer(false)} className="ml-auto rounded-lg p-1.5 hover:bg-surface-2 md:hidden" aria-label="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{renderItems("root", 0)}</div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 md:h-dvh">
      {/* Arborescence : colonne (≥ md) ou tiroir (mobile) */}
      <aside className="hidden w-72 shrink-0 border-r border-line bg-surface md:block lg:w-80">{treePanel}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Arborescence des notes">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[88vw] bg-surface shadow-xl">{treePanel}</div>
        </div>
      )}

      {/* Document */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} className="rounded-lg p-1.5 hover:bg-surface-2 md:hidden" aria-label="Arborescence" aria-expanded={drawer}>
            <PanelLeft className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs text-muted scrollbar-none">
            {doc?.breadcrumb.map((c) => (
              <span key={c.ref} className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => void select(c.ref)} className="hover:text-ink hover:underline">
                  {c.title}
                </button>
                <span>/</span>
              </span>
            ))}
            {doc && <span className="shrink-0 font-medium text-ink">{doc.title}</span>}
          </nav>
          <span role="status" className={`flex shrink-0 items-center gap-2 text-xs ${saving === "error" ? "text-danger" : saving === "idle" ? "text-faint" : "text-warn"}`}>
            {saving === "idle" ? (doc?.editable ? "Enregistré" : "") : saving === "error" ? "Erreur d'enregistrement" : "Enregistrement…"}
            {saving === "error" && (
              <button type="button" onClick={() => void flush()} className="rounded-lg border border-line-strong px-2 py-1 font-medium text-ink hover:bg-surface-2">
                Réessayer
              </button>
            )}
          </span>
        </div>

        {!current || !doc ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            {docLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : current && docError ? (
              <>
                <p className="max-w-md text-sm text-danger">Impossible de charger ce document.</p>
                <button type="button" onClick={() => setDocTick((t) => t + 1)} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-2">
                  Réessayer
                </button>
              </>
            ) : (
              <>
                <NotebookPen className="h-10 w-10 text-faint" />
                <p className="max-w-md text-sm">Choisissez une carte mentale, un nœud, un projet, une étape, une activité ou une tâche dans l&apos;arborescence pour prendre des notes dessus.</p>
                <button type="button" onClick={() => setDrawer(true)} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm md:hidden">
                  Ouvrir l&apos;arborescence
                </button>
              </>
            )}
          </div>
        ) : (
          <article className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-8 sm:px-8">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <ItemIcon item={{ kind: doc.kind, id: doc.id, color: null }} className="h-4 w-4" /> {KIND_LABEL[doc.kind] || "Accueil"}
              {doc.href && (
                <Link href={doc.href} className="ml-auto flex items-center gap-1 rounded-lg border border-line-strong px-2 py-1 normal-case tracking-normal text-ink-2 hover:bg-surface-2">
                  <ExternalLink className="h-3.5 w-3.5" /> Ouvrir l&apos;objet
                </Link>
              )}
            </div>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{doc.title}</h1>
            {doc.updatedAt && <p className="mt-1 text-xs text-faint">Modifié le {new Date(doc.updatedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</p>}
            {doc.editable ? (
              <div className="notes-document mt-6">
                <RichTextEditor key={doc.ref} documentKey={doc.ref} initialHtml={doc.notes} onChange={onChange} minHeight={420} placeholder="Écrivez vos notes… Titres, listes, cases à cocher, images collées." />
              </div>
            ) : doc.kind === "mindmap" || doc.kind === "node" ? (
              <div className="mt-6">
                <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">Lecture seule — carte partagée</p>
                {/* Contenu assaini par sanitizeNotes() (serveur et base locale de l'application). */}
                <div className="notes-document prose max-w-none" dangerouslySetInnerHTML={{ __html: doc.notes }} />
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted">Cette rubrique regroupe des éléments ; dépliez-la dans l&apos;arborescence et choisissez un élément pour prendre des notes.</p>
            )}
            {doc.kind !== "root" && doc.kind !== "section" && <Backlinks key={doc.ref} objectRef={doc.ref} className="mt-8" />}
          </article>
        )}
      </div>
    </div>
  );
}
