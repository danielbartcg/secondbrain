import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, Trash2 } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import type { Store } from "../local/store";
import type { ConflictEntry } from "../local/types";

const KIND_LABEL: Record<ConflictEntry["kind"], string> = {
  overwritten: "Valeur écrasée par le serveur",
  "deleted-on-server": "Supprimé sur le serveur",
  "delete-refused": "Suppression annulée",
  rejected: "Modification refusée",
};
const FIELD_LABEL: Record<string, string> = {
  name: "Nom",
  title: "Titre",
  description: "Description",
  notes: "Notes",
  status: "Statut",
  progress: "Avancement",
  priority: "Priorité",
  complexity: "Complexité",
  startDate: "Début",
  dueDate: "Échéance",
  closedAt: "Date de clôture",
  assigneeId: "Responsable",
  supervisorId: "Superviseur",
  color: "Couleur",
  "*": "Élément",
};

function hrefOf(c: ConflictEntry): string | null {
  if (c.entity === "Task") return `/tasks/${c.entityId}`;
  if (c.entity === "Project") return `/projects/${c.entityId}`;
  if (c.entity === "MindMap") return `/mindmaps/${c.entityId}`;
  return null;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) || "—";
  return JSON.stringify(v).slice(0, 400);
}

/**
 * Historique « Conflits » : chaque fois que le serveur a gardé sa valeur, la
 * vôtre est conservée ici pour pouvoir la recopier (notes riches comprises).
 */
export function Conflicts({ store }: { store: Store }) {
  const list = useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.conflicts,
    () => store.conflicts,
  );
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(c: ConflictEntry) {
    const v = c.localValue;
    await navigator.clipboard.writeText(typeof v === "string" ? v : JSON.stringify(v, null, 2));
    setCopied(c.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Conflits de synchronisation"
        subtitle="Les valeurs les plus récentes proviennent du serveur ; vos valeurs écrasées sont conservées ici."
        actions={
          list.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const c of [...list]) store.removeConflict(c.id);
                store.notify();
              }}
            >
              <Trash2 className="h-4 w-4" /> Tout effacer
            </Button>
          ) : undefined
        }
      />
      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">Aucun conflit.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => {
            const href = hrefOf(c);
            return (
              <li key={c.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-warn" />
                  <span className="font-medium">{KIND_LABEL[c.kind]}</span>
                  <span className="text-muted">·</span>
                  {href ? (
                    <Link href={href} className="font-medium text-brand-700 hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.label}</span>
                  )}
                  <span className="text-muted">· {FIELD_LABEL[c.field] ?? c.field}</span>
                  <span className="ml-auto text-xs text-faint">{new Date(c.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                {c.message && <p className="mt-1 text-xs text-muted">{c.message}</p>}
                {c.kind === "overwritten" && (
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-surface-2 p-2">
                      <div className="mb-1 font-medium text-muted">Votre valeur (écrasée)</div>
                      <div className="whitespace-pre-wrap break-words">{show(c.localValue)}</div>
                    </div>
                    <div className="rounded-lg bg-surface-2 p-2">
                      <div className="mb-1 font-medium text-muted">Valeur retenue (serveur)</div>
                      <div className="whitespace-pre-wrap break-words">{show(c.serverValue)}</div>
                    </div>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  {c.localValue !== null && c.localValue !== undefined && (
                    <Button size="sm" variant="outline" onClick={() => void copy(c)}>
                      {copied === c.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copier ma valeur
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      store.removeConflict(c.id);
                      store.notify();
                    }}
                  >
                    Effacer
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
