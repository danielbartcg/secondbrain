"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Link2, Plus, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import type { RiskDto } from "@/lib/risks";
import { Avatar, Badge, Button, EmptyState, InlineEdit, TASK_STATUS_COLOR, Toggle, errorMessage, inputClass, selectClassXs, toInputDate, toast, todayYmd } from "@/components/ui";
import {
  BENEFIT_LABELS,
  KIND_NOUN,
  PROBABILITY_LABELS,
  RISK_LEVELS,
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  SEVERITY_LABELS,
  levelLabel,
  riskLevel,
  riskScore,
  type RiskKindValue,
  type RiskStatusValue,
} from "@/lib/shared/risks";
import { LEVEL_COLORS, LevelBadge, RiskMatrix, type MatrixCell } from "./risks/RiskMatrix";
import { TaskLinkPicker, type PickableTask } from "./risks/TaskLinkPicker";

/**
 * Onglet « Risques » d'un projet : registre déclaratif des risques et des
 * opportunités (probabilité × gravité / bénéfice, statut, responsable,
 * échéance, plan de traitement, tâches liées) et restitution en matrice 5 × 5.
 *
 * Données : GET /projects/:id/risks ; chaque mutation renvoie la liste
 * complète. Modifications optimistes (retour arrière + message en cas
 * d'erreur). `canEdit` faux ⇒ consultation seule.
 */

type Resp = { risks: RiskDto[] };
type Patch = Partial<Pick<RiskDto, "kind" | "title" | "description" | "category" | "probability" | "impact" | "status" | "ownerId" | "response" | "dueDate">>;
type SortKey = "score" | "ref" | "due";

const STATUS_TONE: Record<RiskStatusValue, "danger" | "warn" | "ok" | "neutral"> = { OPEN: "danger", MONITORING: "warn", TREATED: "ok", CLOSED: "neutral" };

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const f = () => setDesktop(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return desktop;
}

/** Toutes les tâches du projet avec leur chemin « Étape › Activité ». */
function projectTasks(project: ProjectDto): PickableTask[] {
  const out: PickableTask[] = [];
  for (const s of project.stages) {
    for (const t of s.tasks) out.push({ id: t.id, name: t.name, status: t.status, path: s.name });
    for (const a of s.activities) for (const t of a.tasks) out.push({ id: t.id, name: t.name, status: t.status, path: `${s.name} › ${a.name}` });
  }
  for (const t of project.tasks) out.push({ id: t.id, name: t.name, status: t.status, path: "Sans étape" });
  return out;
}

export function ProjectRisksTab({ project, canEdit }: { project: ProjectDto; canEdit: boolean }) {
  const [risks, setRisksState] = useState<RiskDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<RiskKindValue>("RISK");
  const [cell, setCell] = useState<MatrixCell | null>(null);
  const [hideClosed, setHideClosed] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [picker, setPicker] = useState<RiskDto | null>(null);
  const desktop = useIsDesktop();

  const risksRef = useRef<RiskDto[] | null>(null);
  const seq = useRef(0);
  const setRisks = useCallback((next: RiskDto[] | null) => {
    risksRef.current = next;
    setRisksState(next);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Resp>(`/projects/${project.id}/risks`)
      .then((r) => alive && setRisks(r.risks))
      .catch((e) => alive && setLoadError(errorMessage(e, "Chargement des risques impossible.")));
    return () => {
      alive = false;
    };
  }, [project.id, setRisks]);

  const allTasks = useMemo(() => projectTasks(project), [project]);
  const taskById = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  /** Références stables par nature : R1, R2… / O1, O2… (ordre de déclaration). */
  const refs = useMemo(() => {
    const m = new Map<string, string>();
    const n = { RISK: 0, OPPORTUNITY: 0 };
    for (const r of risks ?? []) m.set(r.id, `${KIND_NOUN[r.kind].prefix}${++n[r.kind]}`);
    return m;
  }, [risks]);

  const counts = useMemo(() => {
    const c = { RISK: 0, OPPORTUNITY: 0 };
    for (const r of risks ?? []) c[r.kind]++;
    return c;
  }, [risks]);

  const ofKind = useMemo(() => (risks ?? []).filter((r) => r.kind === kind), [risks, kind]);

  const rows = useMemo(() => {
    let list = ofKind;
    if (hideClosed) list = list.filter((r) => r.status !== "CLOSED");
    if (cell) list = list.filter((r) => r.probability === cell.probability && r.impact === cell.impact);
    const refNum = (r: RiskDto) => Number((refs.get(r.id) ?? "0").slice(1));
    const sorted = [...list];
    if (sort === "score") sorted.sort((a, b) => b.score - a.score || refNum(a) - refNum(b));
    else if (sort === "due") sorted.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.score - a.score);
    else sorted.sort((a, b) => refNum(a) - refNum(b));
    return sorted;
  }, [ofKind, hideClosed, cell, sort, refs]);

  const categories = useMemo(() => [...new Set((risks ?? []).map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [risks]);

  // --- Mutations optimistes --------------------------------------------------

  function applyLocal(r: RiskDto, data: Patch & { taskIds?: string[] }): RiskDto {
    const next = { ...r, ...data } as RiskDto;
    next.score = riskScore(next.probability, next.impact);
    next.level = riskLevel(next.score);
    next.levelLabel = levelLabel(next.kind, next.level);
    if ("ownerId" in data) next.ownerName = project.members.find((m) => m.id === data.ownerId)?.name ?? null;
    if (data.taskIds) next.tasks = data.taskIds.map((id) => taskById.get(id)).filter((t): t is PickableTask => !!t).map((t) => ({ id: t.id, name: t.name, status: t.status }));
    return next;
  }

  async function mutate(optimistic: RiskDto[] | null, call: () => Promise<Resp>, fallback: string) {
    const before = risksRef.current;
    const mine = ++seq.current;
    if (optimistic) setRisks(optimistic);
    try {
      const res = await call();
      if (mine === seq.current) setRisks(res.risks);
    } catch (e) {
      if (mine === seq.current) setRisks(before);
      toast(errorMessage(e, fallback), "error");
    }
  }

  const patch = (r: RiskDto, data: Patch) =>
    mutate(
      (risksRef.current ?? []).map((x) => (x.id === r.id ? applyLocal(x, data) : x)),
      () => api.patch<Resp>(`/risks/${r.id}`, data),
      "Modification impossible.",
    );

  const setTasks = (r: RiskDto, taskIds: string[]) =>
    mutate(
      (risksRef.current ?? []).map((x) => (x.id === r.id ? applyLocal(x, { taskIds }) : x)),
      () => api.put<Resp>(`/risks/${r.id}/tasks`, { taskIds }),
      "Liaison des tâches impossible.",
    );

  const remove = (r: RiskDto) => {
    if (!confirm(`Supprimer ${KIND_NOUN[r.kind].def} « ${r.title} » ? Les liens avec les tâches seront retirés.`)) return;
    void mutate(
      (risksRef.current ?? []).filter((x) => x.id !== r.id),
      () => api.delete<Resp>(`/risks/${r.id}`),
      "Suppression impossible.",
    );
  };

  async function create(title: string, probability: number, impact: number) {
    const res = await api.post<Resp>(`/projects/${project.id}/risks`, { kind, title, probability, impact });
    seq.current++;
    setRisks(res.risks);
  }

  function toggleExpanded(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function focusItem(id: string) {
    setCell(null);
    setHighlight(id);
    setExpanded((s) => new Set(s).add(id));
    window.setTimeout(() => document.getElementById(`risk-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2500);
  }

  // --- Rendu -------------------------------------------------------------------

  if (loadError) return <EmptyState title="Risques indisponibles" hint={loadError} />;
  if (!risks) return <p className="p-6 text-center text-sm text-muted">Chargement des risques…</p>;

  const noun = KIND_NOUN[kind];
  const isOpp = kind === "OPPORTUNITY";
  const openOfKind = ofKind.filter((r) => r.status !== "CLOSED");
  const today = todayYmd();
  const overdue = openOfKind.filter((r) => r.status !== "TREATED" && r.dueDate && r.dueDate < today).length;
  const ctx: RowCtx = {
    project,
    canEdit,
    categories,
    refs,
    expanded,
    highlight,
    today,
    toggleExpanded,
    patch: (r, d) => void patch(r, d),
    remove,
    openPicker: setPicker,
    unlink: (r, id) => void setTasks(r, r.taskIds.filter((t) => t !== id)),
  };

  return (
    <div className="space-y-4">
      {/* En-tête : nature */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-5 w-5 text-brand-600" /> Risques et opportunités
        </h2>
        <div className="ml-auto inline-flex rounded-lg border border-line-strong bg-surface p-0.5" role="tablist" aria-label="Nature">
          {(["RISK", "OPPORTUNITY"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setCell(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${kind === k ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {k === "RISK" ? <AlertTriangle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {k === "RISK" ? "Risques" : "Opportunités"}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${kind === k ? "bg-white/20" : "bg-surface-3"}`}>{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Restitution : matrice + synthèse */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
          <h3 className="mb-3 text-sm font-semibold">
            Matrice {isOpp ? "des opportunités (probabilité × bénéfice)" : "des risques (probabilité × gravité)"}
          </h3>
          <RiskMatrix kind={kind} items={ofKind} refs={refs} selected={cell} onSelectCell={setCell} onSelectItem={focusItem} />
        </section>
        <section className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
          <h3 className="mb-3 text-sm font-semibold">Synthèse</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {[...RISK_LEVELS].reverse().map((l) => {
              const n = openOfKind.filter((r) => r.level === l).length;
              const c = LEVEL_COLORS[kind][l];
              return (
                <div key={l} className="rounded-xl border border-line p-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.bg }} />
                    {levelLabel(kind, l)}
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
                </div>
              );
            })}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {RISK_STATUSES.map((s) => (
              <div key={s} className="flex items-center justify-between gap-2">
                <dt className="text-muted">{RISK_STATUS_LABEL[s]}</dt>
                <dd className="font-medium tabular-nums">{ofKind.filter((r) => r.status === s).length}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">Échéance dépassée</dt>
              <dd className={`font-medium tabular-nums ${overdue > 0 ? "text-danger" : ""}`}>{overdue}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">Sans responsable</dt>
              <dd className="font-medium tabular-nums">{openOfKind.filter((r) => !r.ownerId).length}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">Matrice et synthèse portent sur les éléments non clos. Cliquez une case pour filtrer le tableau.</p>
        </section>
      </div>

      {/* Ajout rapide */}
      {canEdit && <QuickAddRisk key={kind} kind={kind} onAdd={create} />}

      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <h3 className="font-semibold">Tableau des {isOpp ? "opportunités" : "risques"}</h3>
        {cell && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            P{cell.probability} × {isOpp ? "B" : "G"}
            {cell.impact}
            <button type="button" title="Retirer le filtre" onClick={() => setCell(null)} className="rounded-full p-0.5 hover:bg-brand-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Masquer les clos
          <Toggle checked={hideClosed} onChange={setHideClosed} label="Masquer les clos" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          Trier par
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClassXs}>
            <option value="score">Criticité</option>
            <option value="ref">Référence</option>
            <option value="due">Échéance</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
          {ofKind.length === 0
            ? isOpp
              ? "Aucune opportunité déclarée : identifiez ce qui pourrait profiter au projet."
              : "Aucun risque déclaré : identifiez ce qui pourrait compromettre le projet."
            : "Aucun élément ne correspond aux filtres."}
        </p>
      ) : desktop ? (
        <RiskTable rows={rows} kind={kind} ctx={ctx} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RiskCard key={r.id} r={r} ctx={ctx} />
          ))}
        </div>
      )}

      {picker && (
        <TaskLinkPicker
          title={`Tâches liées à ${noun.def} ${refs.get(picker.id) ?? ""} « ${picker.title} »`}
          tasks={allTasks}
          initial={picker.taskIds}
          onClose={() => setPicker(null)}
          onSave={(ids) => {
            const r = picker;
            setPicker(null);
            void setTasks(r, ids);
          }}
        />
      )}
    </div>
  );
}

// --- Ajout rapide ------------------------------------------------------------

function QuickAddRisk({ kind, onAdd }: { kind: RiskKindValue; onAdd: (title: string, p: number, i: number) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [p, setP] = useState(3);
  const [i, setI] = useState(3);
  const [busy, setBusy] = useState(false);
  const isOpp = kind === "OPPORTUNITY";
  const impactLabels = isOpp ? BENEFIT_LABELS : SEVERITY_LABELS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      await onAdd(t, p, i);
      setTitle("");
      setP(3);
      setI(3);
    } catch (err) {
      toast(errorMessage(err, "Ajout impossible."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface-2/60 p-3">
      <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 text-xs text-muted">
        {isOpp ? "Nouvelle opportunité" : "Nouveau risque"}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={isOpp ? "Ex. Subvention régionale, mutualisation avec un autre projet…" : "Ex. Retard fournisseur, départ d'un expert…"}
          className={`${inputClass} w-full`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Probabilité
        <select value={p} onChange={(e) => setP(Number(e.target.value))} className={selectClassXs}>
          {PROBABILITY_LABELS.map((l, k) => (
            <option key={k} value={k + 1}>
              {k + 1} · {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {isOpp ? "Bénéfice" : "Gravité"}
        <select value={i} onChange={(e) => setI(Number(e.target.value))} className={selectClassXs}>
          {impactLabels.map((l, k) => (
            <option key={k} value={k + 1}>
              {k + 1} · {l}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" disabled={busy || !title.trim()} className="h-[34px]">
        <Plus className="h-4 w-4" /> Ajouter
      </Button>
    </form>
  );
}

// --- Lignes ------------------------------------------------------------------

type RowCtx = {
  project: ProjectDto;
  canEdit: boolean;
  categories: string[];
  refs: Map<string, string>;
  expanded: Set<string>;
  highlight: string | null;
  today: string;
  toggleExpanded: (id: string) => void;
  patch: (r: RiskDto, data: Patch) => void;
  remove: (r: RiskDto) => void;
  openPicker: (r: RiskDto) => void;
  unlink: (r: RiskDto, taskId: string) => void;
};

function LevelSelect({ r, field, ctx, className = "" }: { r: RiskDto; field: "probability" | "impact"; ctx: RowCtx; className?: string }) {
  const labels = field === "probability" ? PROBABILITY_LABELS : r.kind === "OPPORTUNITY" ? BENEFIT_LABELS : SEVERITY_LABELS;
  const name = field === "probability" ? "Probabilité" : r.kind === "OPPORTUNITY" ? "Bénéfice" : "Gravité";
  return (
    <select
      value={r[field]}
      disabled={!ctx.canEdit}
      onChange={(e) => ctx.patch(r, field === "probability" ? { probability: Number(e.target.value) } : { impact: Number(e.target.value) })}
      aria-label={name}
      title={`${name} : ${labels[r[field] - 1]}`}
      className={`${selectClassXs} ${className}`}
    >
      {labels.map((l, k) => (
        <option key={k} value={k + 1}>
          {k + 1} · {l}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({ r, ctx, className = "" }: { r: RiskDto; ctx: RowCtx; className?: string }) {
  return (
    <select value={r.status} disabled={!ctx.canEdit} onChange={(e) => ctx.patch(r, { status: e.target.value as RiskStatusValue })} aria-label="Statut" className={`${selectClassXs} ${className}`}>
      {RISK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {RISK_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function OwnerSelect({ r, ctx, className = "" }: { r: RiskDto; ctx: RowCtx; className?: string }) {
  return (
    <select value={r.ownerId ?? ""} disabled={!ctx.canEdit} onChange={(e) => ctx.patch(r, { ownerId: e.target.value || null })} aria-label="Responsable" className={`${selectClassXs} ${className}`}>
      <option value="">— Personne —</option>
      {ctx.project.members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

function DueInput({ r, ctx, className = "" }: { r: RiskDto; ctx: RowCtx; className?: string }) {
  const late = r.dueDate && r.dueDate < ctx.today && r.status !== "CLOSED" && r.status !== "TREATED";
  return (
    <input
      type="date"
      value={toInputDate(r.dueDate)}
      disabled={!ctx.canEdit}
      onChange={(e) => ctx.patch(r, { dueDate: e.target.value || null })}
      aria-label="Échéance"
      title={late ? "Échéance dépassée" : "Échéance"}
      className={`${selectClassXs} ${late ? "border-danger text-danger" : ""} ${className}`}
    />
  );
}

function TitleCell({ r, ctx }: { r: RiskDto; ctx: RowCtx }) {
  return ctx.canEdit ? (
    <InlineEdit value={r.title} onSave={(title) => ctx.patch(r, { title: title.slice(0, 200) })} className="-mx-1.5 font-medium" />
  ) : (
    <span className="font-medium">{r.title}</span>
  );
}

function TaskChips({ r, ctx, max }: { r: RiskDto; ctx: RowCtx; max?: number }) {
  const shown = max ? r.tasks.slice(0, max) : r.tasks;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span key={t.id} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-xs" title={t.name}>
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TASK_STATUS_COLOR[t.status] }} />
          <span className="truncate">{t.name}</span>
          {ctx.canEdit && !max && (
            <button type="button" title="Retirer le lien" onClick={() => ctx.unlink(r, t.id)} className="rounded-full p-0.5 text-faint hover:bg-surface-3 hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {max && r.tasks.length > max && <span className="text-xs text-muted">+{r.tasks.length - max}</span>}
      {ctx.canEdit && (
        <button type="button" onClick={() => ctx.openPicker(r)} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
          <Link2 className="h-3 w-3" /> {r.tasks.length === 0 ? "Lier des tâches" : max ? "Modifier" : "Lier des tâches"}
        </button>
      )}
      {!ctx.canEdit && r.tasks.length === 0 && <span className="text-xs text-faint">—</span>}
    </div>
  );
}

/** Champ texte enregistré à la sortie (permet de vider, contrairement à InlineEdit). */
function BlurText({
  value,
  onSave,
  disabled,
  multiline,
  placeholder,
  maxLength,
  list,
  label,
}: {
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
  maxLength: number;
  list?: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const common = {
    value: draft,
    disabled,
    readOnly: disabled,
    placeholder: disabled ? "" : placeholder,
    maxLength,
    "aria-label": label,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      const v = multiline ? draft : draft.trim();
      if (v !== value) onSave(v);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    className: `${inputClass} w-full disabled:cursor-default disabled:opacity-100`,
  };
  return multiline ? <textarea rows={3} {...common} /> : <input list={list} {...common} />;
}

function RiskDetails({ r, ctx }: { r: RiskDto; ctx: RowCtx }) {
  const isOpp = r.kind === "OPPORTUNITY";
  const listId = `risk-cats-${r.id}`;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Catégorie
        <BlurText value={r.category} onSave={(category) => ctx.patch(r, { category })} disabled={!ctx.canEdit} maxLength={80} list={listId} placeholder="Ex. Technique, Fournisseur, Réglementaire…" label="Catégorie" />
        <datalist id={listId}>
          {ctx.categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Nature
        <select
          value={r.kind}
          disabled={!ctx.canEdit}
          onChange={(e) => ctx.patch(r, { kind: e.target.value as RiskKindValue })}
          className={`${selectClassXs} py-2`}
          title="Changer de nature déplace l'élément dans l'autre registre"
        >
          <option value="RISK">Risque (menace)</option>
          <option value="OPPORTUNITY">Opportunité</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Description
        <BlurText value={r.description} onSave={(description) => ctx.patch(r, { description })} disabled={!ctx.canEdit} multiline maxLength={20_000} placeholder="Cause, événement, conséquences…" label="Description" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {isOpp ? "Plan d'exploitation" : "Plan de traitement"}
        <BlurText
          value={r.response}
          onSave={(response) => ctx.patch(r, { response })}
          disabled={!ctx.canEdit}
          multiline
          maxLength={20_000}
          placeholder={isOpp ? "Actions pour saisir l'opportunité…" : "Actions de prévention, d'atténuation, de repli…"}
          label={isOpp ? "Plan d'exploitation" : "Plan de traitement"}
        />
      </label>
      <div className="flex flex-col gap-1 text-xs text-muted md:col-span-2">
        Tâches liées ({r.tasks.length})
        <TaskChips r={r} ctx={ctx} />
      </div>
    </div>
  );
}

function DeleteButton({ r, ctx }: { r: RiskDto; ctx: RowCtx }) {
  if (!ctx.canEdit) return null;
  return (
    <button type="button" title="Supprimer" onClick={() => ctx.remove(r)} className="rounded-lg p-1.5 text-faint hover:bg-red-50 hover:text-danger">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function OwnerAvatar({ r, ctx }: { r: RiskDto; ctx: RowCtx }) {
  const m = r.ownerId ? ctx.project.members.find((x) => x.id === r.ownerId) : null;
  if (!m) return null;
  return <Avatar id={m.id} name={m.name} color={m.color} src={m.avatarUrl} size={22} />;
}

function RiskTable({ rows, kind, ctx }: { rows: RiskDto[]; kind: RiskKindValue; ctx: RowCtx }) {
  const isOpp = kind === "OPPORTUNITY";
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-xs font-medium text-muted">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2">Réf.</th>
            <th className="px-2 py-2">Titre</th>
            <th className="px-2 py-2">Probabilité</th>
            <th className="px-2 py-2">{isOpp ? "Bénéfice" : "Gravité"}</th>
            <th className="px-2 py-2">Criticité</th>
            <th className="px-2 py-2">Statut</th>
            <th className="px-2 py-2">Responsable</th>
            <th className="px-2 py-2">Échéance</th>
            <th className="px-2 py-2">Tâches liées</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = ctx.expanded.has(r.id);
            return (
              <Fragment key={r.id}>
                <tr id={`risk-${r.id}`} className={`border-b border-line align-middle transition-colors ${ctx.highlight === r.id ? "bg-brand-50" : open ? "bg-surface-2/50" : "hover:bg-surface-2/40"} ${r.status === "CLOSED" ? "opacity-60" : ""}`}>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => ctx.toggleExpanded(r.id)} aria-expanded={open} title={open ? "Replier" : "Détails, plan, tâches"} className="rounded p-1 text-muted hover:bg-surface-3">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs font-semibold text-ink-2">{ctx.refs.get(r.id)}</td>
                  <td className="max-w-[18rem] px-2 py-2">
                    <TitleCell r={r} ctx={ctx} />
                    {r.category && <div className="truncate text-xs text-muted">{r.category}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <LevelSelect r={r} field="probability" ctx={ctx} className="w-32" />
                  </td>
                  <td className="px-2 py-2">
                    <LevelSelect r={r} field="impact" ctx={ctx} className="w-32" />
                  </td>
                  <td className="px-2 py-2">
                    <LevelBadge kind={r.kind} score={r.score} level={r.level} label={r.levelLabel} />
                  </td>
                  <td className="px-2 py-2">
                    <StatusSelect r={r} ctx={ctx} className="w-36" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <OwnerAvatar r={r} ctx={ctx} />
                      <OwnerSelect r={r} ctx={ctx} className="w-36" />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <DueInput r={r} ctx={ctx} />
                  </td>
                  <td className="max-w-[16rem] px-2 py-2">
                    <TaskChips r={r} ctx={ctx} max={2} />
                  </td>
                  <td className="px-2 py-2">
                    <DeleteButton r={r} ctx={ctx} />
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-line bg-surface-2/50">
                    <td />
                    <td colSpan={10} className="px-2 pb-4 pt-1">
                      <RiskDetails r={r} ctx={ctx} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiskCard({ r, ctx }: { r: RiskDto; ctx: RowCtx }) {
  const open = ctx.expanded.has(r.id);
  const isOpp = r.kind === "OPPORTUNITY";
  return (
    <section id={`risk-${r.id}`} className={`rounded-2xl border bg-surface p-3 transition-colors ${ctx.highlight === r.id ? "border-brand-500" : "border-line"} ${r.status === "CLOSED" ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-xs font-semibold text-ink-2">{ctx.refs.get(r.id)}</span>
        <div className="min-w-0 flex-1">
          <TitleCell r={r} ctx={ctx} />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <LevelBadge kind={r.kind} score={r.score} level={r.level} label={r.levelLabel} />
            <Badge tone={STATUS_TONE[r.status]}>{RISK_STATUS_LABEL[r.status]}</Badge>
            {r.category && <span className="text-xs text-muted">{r.category}</span>}
          </div>
        </div>
        <DeleteButton r={r} ctx={ctx} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Probabilité
          <LevelSelect r={r} field="probability" ctx={ctx} className="w-full" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {isOpp ? "Bénéfice" : "Gravité"}
          <LevelSelect r={r} field="impact" ctx={ctx} className="w-full" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Statut
          <StatusSelect r={r} ctx={ctx} className="w-full" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Échéance
          <DueInput r={r} ctx={ctx} className="w-full" />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
          Responsable
          <OwnerSelect r={r} ctx={ctx} className="w-full" />
        </label>
      </div>
      {!open && (
        <div className="mt-2">
          <TaskChips r={r} ctx={ctx} max={3} />
        </div>
      )}
      <button type="button" onClick={() => ctx.toggleExpanded(r.id)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Masquer les détails" : isOpp ? "Description, plan d'exploitation" : "Description, plan de traitement"}
      </button>
      {open && (
        <div className="mt-2">
          <RiskDetails r={r} ctx={ctx} />
        </div>
      )}
    </section>
  );
}
