"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, ExternalLink, FolderKanban, LayoutTemplate, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { MapTemplateSummary, ProjectTemplateSummary, TemplatesDto } from "@/lib/templates";
import { Button, errorMessage, inputClass, selectClass, toast } from "@/components/ui";
import { loadTemplates } from "@/components/templates/TemplatePicker";

/**
 * Administration → Modèles : projets types et cartes types. Un modèle s'édite
 * avec les écrans habituels (ouverts en mode « modèle ») ; il se crée vierge
 * ou à partir de la structure d'un projet / d'une carte existants.
 */

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

export function AdminTemplates({ initial, projects, maps }: { initial: TemplatesDto; projects: { id: string; name: string }[]; maps: { id: string; title: string }[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setTemplates(await loadTemplates(true));
  }

  async function createProject(name: string, fromProjectId: string) {
    setBusy(true);
    try {
      const { project } = await api.post<{ project: { id: string } }>("/admin/templates/projects", { name, fromProjectId: fromProjectId || null });
      await loadTemplates(true);
      router.push(`/projects/${project.id}#plan`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }
  async function createMap(title: string, fromMapId: string) {
    setBusy(true);
    try {
      const { mindmap } = await api.post<{ mindmap: { id: string } }>("/admin/templates/maps", { title, fromMapId: fromMapId || null });
      await loadTemplates(true);
      router.push(`/mindmaps/${mindmap.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }
  async function remove(kind: "project" | "map", id: string, name: string) {
    if (!window.confirm(`Supprimer le modèle « ${name} » ? Les projets et cartes déjà créés à partir de lui ne sont pas touchés.`)) return;
    try {
      await api.delete(kind === "project" ? `/projects/${id}` : `/mindmaps/${id}`);
      await refresh();
      toast("Modèle supprimé.", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <LayoutTemplate className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted">
            Les <b className="text-ink">projets types</b> et <b className="text-ink">cartes types</b> s&apos;éditent avec les écrans habituels. Un projet type porte la
            structure (étapes, activités, tâches avec priorité, complexité, prérequis et notes, livrables, risques) ; les dates, l&apos;équipe, les affectations et les
            statuts se renseignent dans chaque projet. À la création d&apos;un projet ou d&apos;une carte — ou ensuite tant qu&apos;il est vide —, chacun peut partir d&apos;un modèle.
          </p>
        </div>
      </section>

      <TemplateSection
        icon={<FolderKanban className="h-5 w-5 text-brand-600" />}
        title="Projets types"
        empty="Aucun projet type."
        items={templates.projects.map((p: ProjectTemplateSummary) => ({
          id: p.id,
          name: p.name,
          href: `/projects/${p.id}#plan`,
          color: p.color,
          meta: [plural(p.stageCount, "étape"), plural(p.taskCount, "tâche"), p.deliverableCount ? plural(p.deliverableCount, "livrable") : "", p.riskCount ? plural(p.riskCount, "risque") : ""].filter(Boolean).join(" · "),
        }))}
        sources={[{ group: "Projets", items: projects.map((p) => ({ id: p.id, label: p.name })) }, { group: "Projets types", items: templates.projects.map((p) => ({ id: p.id, label: p.name })) }]}
        namePlaceholder="Nom du projet type (ex. Déploiement client)"
        busy={busy}
        onCreate={createProject}
        onDelete={(id, name) => void remove("project", id, name)}
      />
      <TemplateSection
        icon={<Brain className="h-5 w-5 text-brand-600" />}
        title="Cartes types"
        empty="Aucune carte type."
        items={templates.maps.map((m: MapTemplateSummary) => ({ id: m.id, name: m.title, href: `/mindmaps/${m.id}`, color: "#8b5cf6", meta: plural(m.nodeCount, "nœud") }))}
        sources={[{ group: "Cartes", items: maps.map((m) => ({ id: m.id, label: m.title })) }, { group: "Cartes types", items: templates.maps.map((m) => ({ id: m.id, label: m.title })) }]}
        namePlaceholder="Titre de la carte type (ex. Atelier de cadrage)"
        busy={busy}
        onCreate={createMap}
        onDelete={(id, name) => void remove("map", id, name)}
      />
    </div>
  );
}

function TemplateSection({
  icon,
  title,
  empty,
  items,
  sources,
  namePlaceholder,
  busy,
  onCreate,
  onDelete,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  items: { id: string; name: string; href: string; color: string | null; meta: string }[];
  sources: { group: string; items: { id: string; label: string }[] }[];
  namePlaceholder: string;
  busy: boolean;
  onCreate: (name: string, fromId: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="text-sm text-muted">({items.length})</span>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color ?? "var(--color-line-strong)" }} />
              <div className="min-w-0 flex-1">
                <Link href={t.href} className="block truncate font-medium hover:underline">
                  {t.name}
                </Link>
                <span className="text-xs text-muted">{t.meta}</span>
              </div>
              <Link href={t.href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-brand-700 hover:bg-brand-50">
                <ExternalLink className="h-4 w-4" /> <span className="hidden sm:inline">Modifier</span>
              </Link>
              <button type="button" onClick={() => onDelete(t.id, t.name)} className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger" title="Supprimer le modèle" aria-label={`Supprimer ${t.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim(), from);
        }}
        className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3"
      >
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-muted">
          Nouveau modèle
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={namePlaceholder} className={inputClass} />
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1 text-xs text-muted">
          Structure de départ
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${selectClass} py-2`}>
            <option value="">Vierge</option>
            {sources
              .filter((g) => g.items.length)
              .map((g) => (
                <optgroup key={g.group} label={`Copier : ${g.group.toLowerCase()}`}>
                  {g.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer et modifier
        </Button>
      </form>
    </section>
  );
}
