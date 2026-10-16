"use client";

import { useEffect, useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { api } from "@/lib/client";
import type { TemplatesDto } from "@/lib/templates";
import { Button, errorMessage, selectClass, toast } from "@/components/ui";

/**
 * Modèles (projets types, cartes types) : choix « Feuille blanche » ou modèle
 * à la création, et bandeau « Partir d'un modèle » sur un projet / une carte
 * encore vide. Liste chargée une fois (GET /templates).
 */

let cache: TemplatesDto | null = null;
let pending: Promise<TemplatesDto> | null = null;
export function loadTemplates(force = false): Promise<TemplatesDto> {
  if (force) {
    cache = null;
    pending = null;
  }
  if (cache) return Promise.resolve(cache);
  pending ??= api.get<{ templates: TemplatesDto }>("/templates").then((r) => (cache = r.templates));
  return pending.catch((e) => {
    pending = null;
    throw e;
  });
}

export function useTemplates(): TemplatesDto | null {
  const [t, setT] = useState<TemplatesDto | null>(cache);
  useEffect(() => {
    let alive = true;
    loadTemplates()
      .then((v) => alive && setT(v))
      .catch(() => alive && setT({ projects: [], maps: [] }));
    return () => {
      alive = false;
    };
  }, []);
  return t;
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

/** Liste « Partir de » : feuille blanche (valeur "") ou un modèle. Rien si aucun modèle. */
export function TemplateSelect({ kind, value, onChange, className = "" }: { kind: "project" | "map"; value: string; onChange: (id: string) => void; className?: string }) {
  const t = useTemplates();
  const list = kind === "project" ? (t?.projects ?? []) : (t?.maps ?? []);
  if (!list.length) return null;
  return (
    <label className={`flex min-w-0 items-center gap-2 text-sm text-muted ${className}`}>
      <LayoutTemplate className="h-4 w-4 shrink-0" />
      <span className="shrink-0">Partir de</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${selectClass} min-w-0 flex-1 text-ink sm:text-sm`} aria-label="Partir d'un modèle">
        <option value="">Feuille blanche</option>
        {kind === "project"
          ? (t?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {plural(p.stageCount, "étape")}, {plural(p.taskCount, "tâche")}
                {p.riskCount ? `, ${plural(p.riskCount, "risque")}` : ""}
              </option>
            ))
          : (t?.maps ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} — {plural(m.nodeCount, "nœud")}
              </option>
            ))}
      </select>
    </label>
  );
}

/** Bandeau d'un projet / d'une carte vide : appliquer un modèle. */
export function ApplyTemplateBanner({ kind, targetId, onApplied, className = "" }: { kind: "project" | "map"; targetId: string; onApplied: (result: unknown) => void; className?: string }) {
  const t = useTemplates();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const list = kind === "project" ? (t?.projects ?? []) : (t?.maps ?? []);
  if (!list.length) return null;
  async function apply() {
    if (!choice) return;
    setBusy(true);
    try {
      const r = await api.post(`/${kind === "project" ? "projects" : "mindmaps"}/${targetId}/apply-template`, { templateId: choice });
      toast(kind === "project" ? "Projet initialisé à partir du modèle." : "Carte initialisée à partir du modèle.", "ok");
      onApplied(r);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-brand-300 bg-brand-50/60 p-3 text-sm ${className}`}>
      <span className="font-medium text-brand-700">{kind === "project" ? "Ce projet est vide." : "Cette carte est vide."}</span>
      <TemplateSelect kind={kind} value={choice} onChange={setChoice} className="min-w-[14rem] flex-1" />
      <Button size="sm" onClick={() => void apply()} disabled={!choice || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />} Appliquer le modèle
      </Button>
    </div>
  );
}
