"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowDownAZ, ArrowDownZA, ArrowUp, GripVertical, List, ListPlus, Loader2, Plus, Search, SlidersHorizontal, Trash2, Type, X } from "lucide-react";
import { api } from "@/lib/client";
import { CUSTOM_FIELD_TYPE_LABEL, OPTION_SORT_LABEL, sortOptions, type CustomFieldDto, type CustomFieldOption, type CustomFieldTypeValue, type CustomOptionSortValue } from "@/lib/shared/custom-fields";
import { Badge, Button, InlineEdit, errorMessage, inputClass, toast } from "@/components/ui";

/**
 * Administration → Champs personnalisés des projets (ex. « Client ») : texte
 * libre ou liste de valeurs gérée ici (`OptionsManager` : tri forcé A → Z /
 * Z → A ou ordre manuel par glisser-déposer, recherche, ajout en masse). Renommer une valeur la renomme dans
 * tous les projets ; supprimer une valeur ou un champ efface ces valeurs des
 * projets (confirmation). Archiver masque le champ des fiches projet en
 * conservant les valeurs.
 */
export function AdminCustomFields({ initial, usage: initialUsage }: { initial: CustomFieldDto[]; usage: Record<string, number> }) {
  const [fields, setFields] = useState(initial);
  const [usage, setUsage] = useState(initialUsage);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldTypeValue>("LIST");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ fields: CustomFieldDto[] }>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      setFields(r.fields);
      const u = await api.get<{ usage: Record<string, number> }>("/admin/custom-fields").catch(() => null);
      if (u) setUsage(u.usage);
      if (ok) toast(ok, "ok");
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    if (await run(() => api.post("/admin/custom-fields", { label: label.trim(), type }), `Champ « ${label.trim()} » créé.`)) setLabel("");
  }

  const patch = (f: CustomFieldDto, body: Record<string, unknown>, ok?: string) => run(() => api.patch(`/admin/custom-fields/${f.id}`, body), ok);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Champs personnalisés des projets</h2>
            <p className="text-sm text-muted">
              Informations communes à tous les projets (ex. « Client », « Programme », « Code analytique ») : texte libre ou liste de valeurs que vous gérez ici.
              Elles se renseignent dans chaque projet (bloc « Informations ») et figurent dans l&apos;export Excel et le connecteur Claude.
            </p>
          </div>
        </div>
        <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted">
            Libellé
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Ex. Client" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as CustomFieldTypeValue)} className={`${inputClass} py-2`}>
              <option value="LIST">Liste de valeurs</option>
              <option value="TEXT">Texte libre</option>
            </select>
          </label>
          <Button type="submit" disabled={busy || !label.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter le champ
          </Button>
        </form>
      </section>

      {fields.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-muted">Aucun champ personnalisé pour l&apos;instant.</p>}

      {fields.map((f, i) => (
        <FieldCard
          key={f.id}
          field={f}
          index={i}
          count={fields.length}
          used={usage[f.id] ?? 0}
          usage={usage}
          busy={busy}
          onPatch={(body, ok) => patch(f, body, ok)}
          onDelete={() => {
            const used = usage[f.id] ?? 0;
            if (!window.confirm(`Supprimer définitivement le champ « ${f.label} » ?${used ? `\n\nSa valeur sera effacée de ${used} projet${used > 1 ? "s" : ""}. Pour la conserver, archivez plutôt le champ.` : ""}`)) return;
            void run(() => api.delete(`/admin/custom-fields/${f.id}`), `Champ « ${f.label} » supprimé.`);
          }}
        />
      ))}
    </div>
  );
}

function FieldCard({
  field: f,
  index,
  count,
  used,
  usage,
  busy,
  onPatch,
  onDelete,
}: {
  field: CustomFieldDto;
  index: number;
  count: number;
  used: number;
  usage: Record<string, number>;
  busy: boolean;
  onPatch: (body: Record<string, unknown>, ok?: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${f.active ? "" : "opacity-70"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-muted">{f.type === "LIST" ? <List className="h-4 w-4" /> : <Type className="h-4 w-4" />}</span>
        <InlineEdit value={f.label} onSave={(label) => void onPatch({ label: label.slice(0, 60) }, "Libellé modifié.")} className="-mx-1.5 min-w-0 flex-1 font-semibold" />
        <Badge tone="neutral">{CUSTOM_FIELD_TYPE_LABEL[f.type]}</Badge>
        {!f.active && <Badge tone="warn">Archivé</Badge>}
        <span className="text-xs text-muted">
          {used} projet{used > 1 ? "s" : ""} renseigné{used > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" disabled={busy || index === 0} onClick={() => void onPatch({ order: index - 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" title="Monter" aria-label="Monter">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={busy || index === count - 1} onClick={() => void onPatch({ order: index + 1 })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" title="Descendre" aria-label="Descendre">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPatch({ active: !f.active }, f.active ? "Champ archivé : masqué des projets, valeurs conservées." : "Champ réactivé.")}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2"
            title={f.active ? "Archiver (masquer sans perdre les valeurs)" : "Réactiver"}
            aria-label={f.active ? "Archiver" : "Réactiver"}
          >
            {f.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </button>
          <button type="button" disabled={busy} onClick={onDelete} className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger" title="Supprimer" aria-label="Supprimer le champ">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>
      {f.type === "LIST" ? (
        <OptionsManager field={f} usage={usage} busy={busy} onPatch={onPatch} />
      ) : (
        <p className="px-4 py-3 text-sm text-muted">Texte libre, saisi dans chaque projet (500 caractères au plus).</p>
      )}
    </section>
  );
}

type DragState = { id: string; from: number; over: number; dy: number; startY: number; rects: { top: number; height: number }[] };

/**
 * Gestion des valeurs d'une liste : tri forcé (A → Z, Z → A) ou ordre manuel
 * par glisser-déposer (souris et tactile, poignée) et boutons monter /
 * descendre (clavier). Glisser une valeur alors qu'un tri est forcé repasse
 * en ordre manuel. Recherche (au-delà de 8 valeurs), nombre de projets par
 * valeur, renommage en place, ajout unitaire ou en masse (une par ligne).
 */
function OptionsManager({ field: f, usage, busy, onPatch }: { field: CustomFieldDto; usage: Record<string, number>; busy: boolean; onPatch: (body: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const [items, setItems] = useState<CustomFieldOption[]>(f.options);
  const [sort, setSort] = useState<CustomOptionSortValue>(f.optionSort);
  const [query, setQuery] = useState("");
  const [newValue, setNewValue] = useState("");
  const [bulk, setBulk] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Le serveur fait foi après chaque enregistrement.
  useEffect(() => {
    setItems(f.options);
    setSort(f.optionSort);
  }, [f.options, f.optionSort]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? items.filter((o) => o.label.toLowerCase().includes(q)) : items), [items, q]);
  const canDrag = !q && !busy && items.length > 1;

  async function save(next: CustomFieldOption[], extra: Record<string, unknown> = {}, ok?: string) {
    const nextSort = (extra.optionSort as CustomOptionSortValue | undefined) ?? sort;
    setItems(sortOptions(next, nextSort));
    if (!(await onPatch({ options: next.map((o) => (o.id ? o : { label: o.label })), ...extra }, ok))) setItems(f.options);
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    const forced = sort !== "MANUAL";
    if (forced) setSort("MANUAL");
    void save(next, forced ? { optionSort: "MANUAL" } : {}, forced ? "Ordre manuel activé : la liste n'est plus triée automatiquement." : undefined);
  }

  function changeSort(next: CustomOptionSortValue) {
    if (next === sort) return;
    setSort(next);
    setItems(sortOptions(items, next));
    void onPatch({ optionSort: next }, next === "MANUAL" ? "Ordre manuel : glissez les valeurs pour les réorganiser." : `Valeurs triées ${OPTION_SORT_LABEL[next]}.`).then((ok) => {
      if (!ok) {
        setSort(f.optionSort);
        setItems(f.options);
      }
    });
  }

  // --- Glisser-déposer (pointeur : souris, stylet, doigt) ---
  function onGripDown(e: React.PointerEvent, id: string, index: number) {
    if (!canDrag || e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    const rects = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top, height: b.height };
    });
    setDrag({ id, from: index, over: index, dy: 0, startY: e.clientY, rects });
  }
  function onGripMove(e: React.PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const r = drag.rects[drag.from];
    const center = r.top + r.height / 2 + dy;
    let over = drag.rects.findIndex((x) => center < x.top + x.height);
    if (over < 0) over = drag.rects.length - 1;
    setDrag({ ...drag, dy, over: Math.max(0, over) });
  }
  function onGripUp() {
    if (!drag) return;
    const { from, over } = drag;
    setDrag(null);
    move(from, over);
  }
  function shiftFor(index: number): number {
    if (!drag || index === drag.from) return 0;
    const h = drag.rects[drag.from]?.height ?? 0;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return -h;
    if (drag.from > drag.over && index < drag.from && index >= drag.over) return h;
    return 0;
  }

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    const label = newValue.trim();
    if (!label) return;
    if (items.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      toast(`La valeur « ${label} » existe déjà.`, "error");
      return;
    }
    setNewValue("");
    await save([...items, { id: "", label }]);
  }

  async function addBulk() {
    const known = new Set(items.map((o) => o.label.toLowerCase()));
    const seen = new Set<string>();
    const values = (bulk ?? "")
      .split(/\n|;/)
      .map((v) => v.trim())
      .filter((v) => v && !known.has(v.toLowerCase()) && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    if (!values.length) {
      toast("Aucune nouvelle valeur à ajouter.", "error");
      return;
    }
    const n = values.length;
    if (await onPatch({ options: [...items, ...values.map((label) => ({ label }))] }, `${n} valeur${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.`)) setBulk(null);
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Tri des valeurs">
          {(["MANUAL", "ASC", "DESC"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={sort === m}
              disabled={busy}
              onClick={() => changeSort(m)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${sort === m ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {m === "MANUAL" ? <GripVertical className="h-3.5 w-3.5" /> : m === "ASC" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowDownZA className="h-3.5 w-3.5" />}
              {OPTION_SORT_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">
          {items.length} valeur{items.length > 1 ? "s" : ""}
        </span>
        {items.length > 8 && (
          <label className="relative ml-auto min-w-[10rem] flex-1 sm:max-w-[16rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer les valeurs" aria-label="Filtrer les valeurs" className={`${inputClass} w-full py-1 pl-8 text-sm`} />
          </label>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {sort === "MANUAL"
          ? "Glissez une valeur par sa poignée pour changer l'ordre proposé dans les projets."
          : `Tri automatique ${OPTION_SORT_LABEL[sort]} : les nouvelles valeurs se rangent d'elles-mêmes. Glisser une valeur repasse en ordre manuel.`}
        {q && " Le filtre suspend le glisser-déposer."}
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">Aucune valeur : ajoutez-en ci-dessous.</p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucune valeur ne correspond au filtre.</p>
      ) : (
        <ul ref={listRef} className="mt-3 divide-y divide-line rounded-xl border border-line" aria-label={`Valeurs de ${f.label}`}>
          {visible.map((o) => {
            const i = items.indexOf(o);
            const n = usage[`${f.id}/${o.id}`] ?? 0;
            const dragging = drag?.id === o.id;
            return (
              <li
                key={o.id || `new-${o.label}`}
                className={`flex items-center gap-2 bg-surface px-2 py-1.5 first:rounded-t-xl last:rounded-b-xl ${dragging ? "relative z-10 shadow-lg ring-1 ring-brand-500" : drag ? "transition-transform" : ""}`}
                style={{ transform: dragging ? `translateY(${drag.dy}px)` : `translateY(${shiftFor(i)}px)` }}
              >
                <button
                  type="button"
                  disabled={!canDrag}
                  onPointerDown={(e) => onGripDown(e, o.id, i)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                  onPointerCancel={() => setDrag(null)}
                  className="cursor-grab touch-none rounded p-1 text-faint hover:bg-surface-2 hover:text-ink active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                  title="Glisser pour déplacer"
                  aria-label={`Déplacer ${o.label}`}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-faint">{i + 1}</span>
                <InlineEdit
                  value={o.label}
                  onSave={(label) => void save(items.map((x) => (x.id === o.id ? { id: x.id, label: label.slice(0, 100) } : x)), {}, "Valeur renommée dans tous les projets.")}
                  className="-mx-1 min-w-0 flex-1 text-sm"
                />
                {n > 0 && (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted" title={`Utilisée par ${n} projet${n > 1 ? "s" : ""}`}>
                    {n} projet{n > 1 ? "s" : ""}
                  </span>
                )}
                <div className="flex shrink-0 items-center">
                  <button type="button" disabled={busy || !!q || i === 0} onClick={() => move(i, i - 1)} className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30" title="Monter" aria-label={`Monter ${o.label}`}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={busy || !!q || i === items.length - 1} onClick={() => move(i, i + 1)} className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30" title="Descendre" aria-label={`Descendre ${o.label}`}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (n && !window.confirm(`Retirer la valeur « ${o.label} » ? Elle sera effacée de ${n} projet${n > 1 ? "s" : ""}.`)) return;
                      void save(items.filter((x) => x !== o));
                    }}
                    className="rounded p-1 text-faint hover:bg-red-50 hover:text-danger"
                    title="Retirer la valeur"
                    aria-label={`Retirer ${o.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {bulk === null ? (
        <form onSubmit={addOne} className="mt-3 flex flex-wrap gap-2">
          <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Nouvelle valeur" maxLength={100} aria-label="Nouvelle valeur" className={`${inputClass} min-w-[12rem] flex-1 py-1.5`} />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !newValue.trim()}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBulk("")} disabled={busy}>
            <ListPlus className="h-4 w-4" /> Ajout en masse
          </Button>
        </form>
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
          <label className="text-xs font-medium text-ink-2" htmlFor={`bulk-${f.id}`}>
            Une valeur par ligne (les doublons sont ignorés)
          </label>
          <textarea id={`bulk-${f.id}`} value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} maxLength={20000} autoFocus className={`${inputClass} mt-1 w-full font-mono text-sm`} placeholder={"Valeur 1\nValeur 2\nValeur 3"} />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setBulk(null)}>
              Annuler
            </Button>
            <Button size="sm" onClick={() => void addBulk()} disabled={busy || !bulk.trim()}>
              <ListPlus className="h-4 w-4" /> Ajouter les valeurs
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
