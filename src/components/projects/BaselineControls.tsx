"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Flag, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import type { BaselineDto, BaselineSummary } from "@/lib/shared/baseline";
import { baselineSpans, baselineSummary, fmtShort, fmtSlip, stageSlips, type Span } from "@/components/gantt/ganttModel";
import { errorMessage, selectClassXs, toast } from "@/components/ui";

/**
 * Planning de référence du Gantt : choisir une référence, figer le planning
 * actuel, supprimer ; synthèse des écarts (fin du projet, tâches en retard ou
 * en avance, ajoutées, retirées) et glissement par étape. Les étendues de la
 * référence choisie sont remontées au Gantt (`onSpans`) pour les barres
 * fantômes. En ligne uniquement (application : message sobre hors ligne).
 */

const fmtDateTime = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function SlipText({ d }: { d: number | null }) {
  if (d === null) return <span className="text-muted">—</span>;
  return <span className={`font-semibold tabular-nums ${d > 0 ? "text-danger" : d < 0 ? "text-ok" : "text-muted"}`}>{fmtSlip(d)}</span>;
}

export function BaselineControls({ project, currentUserId, onSpans }: { project: ProjectDto; currentUserId: string; onSpans: (spans: Map<string, Span> | null) => void }) {
  const [list, setList] = useState<BaselineSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [baseline, setBaseline] = useState<BaselineDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStages, setShowStages] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ baselines: BaselineSummary[] }>(`/projects/${project.id}/baselines`)
      .then((r) => {
        if (!alive) return;
        setList(r.baselines);
        setSelectedId(r.baselines[0]?.id ?? "");
      })
      .catch(() => alive && setOffline(true));
    return () => {
      alive = false;
    };
  }, [project.id]);

  useEffect(() => {
    if (!selectedId) {
      setBaseline(null);
      return;
    }
    if (baseline?.id === selectedId) return;
    let alive = true;
    api
      .get<{ baseline: BaselineDto }>(`/projects/${project.id}/baselines/${selectedId}`)
      .then((r) => alive && setBaseline(r.baseline))
      .catch((e) => toast(errorMessage(e), "error"));
    return () => {
      alive = false;
    };
  }, [selectedId, project.id, baseline?.id]);

  const spans = useMemo(() => (baseline && baseline.id === selectedId ? baselineSpans(baseline.data) : null), [baseline, selectedId]);
  useEffect(() => onSpans(spans), [spans, onSpans]);

  const summary = useMemo(() => (spans && baseline ? baselineSummary(project, baseline.data, spans) : null), [spans, baseline, project]);
  const slips = useMemo(() => (spans ? stageSlips(project, spans) : []), [spans, project]);

  async function freeze() {
    const name = window.prompt("Nom du planning de référence :", `Référence du ${fmtDateTime(new Date().toISOString())}`);
    if (name === null || !name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ baseline: BaselineDto }>(`/projects/${project.id}/baselines`, { name: name.trim() });
      setList((l) => [r.baseline, ...(l ?? [])]);
      setBaseline(r.baseline);
      setSelectedId(r.baseline.id);
      toast("Planning actuel figé comme référence.", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const b = list?.find((x) => x.id === selectedId);
    if (!b || !window.confirm(`Supprimer le planning de référence « ${b.name} » ?`)) return;
    setBusy(true);
    try {
      await api.delete(`/projects/${project.id}/baselines/${b.id}`);
      const rest = (list ?? []).filter((x) => x.id !== b.id);
      setList(rest);
      setSelectedId(rest[0]?.id ?? "");
      toast("Planning de référence supprimé.", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (offline) return null;
  const selected = list?.find((x) => x.id === selectedId) ?? null;
  const canDelete = !!selected && (selected.createdById === currentUserId || project.ownerId === currentUserId);

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Flag className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <label htmlFor="baseline-select" className="font-medium text-ink-2">
          Planning de référence
        </label>
        {list === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        ) : (
          <select id="baseline-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={`${selectClassXs} max-w-[16rem]`}>
            <option value="">Aucun (masqué)</option>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {fmtDateTime(b.createdAt)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={freeze}
          disabled={busy || list === null}
          className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-3 disabled:opacity-50 md:py-1"
        >
          Figer le planning actuel
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            title="Supprimer ce planning de référence"
            aria-label="Supprimer ce planning de référence"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-danger disabled:opacity-50 md:h-7 md:w-7"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {list !== null && list.length === 0 && (
        <p className="mt-1.5 text-xs text-muted">
          Figez le planning à un moment clé (lancement, comité) : le Gantt affichera ensuite, sous chaque barre, sa position de référence et le glissement en jours.
        </p>
      )}

      {selected && summary && (
        <>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>
              Fin du projet : {summary.projectSlip === 0 ? <span className="font-semibold text-ok">inchangée</span> : <SlipText d={summary.projectSlip} />}
            </span>
            <span>{plural(summary.late, "tâche en retard", "tâches en retard")} sur la référence</span>
            <span>{plural(summary.early, "en avance", "en avance")}</span>
            {summary.added > 0 && <span>{plural(summary.added, "tâche ajoutée", "tâches ajoutées")}</span>}
            {summary.removed > 0 && <span>{plural(summary.removed, "tâche retirée", "tâches retirées")}</span>}
            <span className="text-muted">
              Figée par {selected.createdByName} le {fmtDateTime(selected.createdAt)}
            </span>
          </p>
          {slips.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowStages((v) => !v)} aria-expanded={showStages} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                {showStages ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Glissement par étape
              </button>
              {showStages && (
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-2 font-medium">Étape</th>
                        <th className="py-1 pr-2 font-medium">Fin de référence</th>
                        <th className="py-1 pr-2 font-medium">Fin actuelle</th>
                        <th className="py-1 pr-2 text-right font-medium">Début</th>
                        <th className="py-1 text-right font-medium">Fin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slips.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="max-w-[14rem] truncate py-1 pr-2 text-ink" title={s.name}>
                            {s.name}
                          </td>
                          <td className="py-1 pr-2 tabular-nums text-ink-2">{s.base ? fmtShort(s.base.end) : "absente"}</td>
                          <td className="py-1 pr-2 tabular-nums text-ink-2">{s.current ? fmtShort(s.current.end) : "—"}</td>
                          <td className="py-1 pr-2 text-right">
                            <SlipText d={s.startSlip} />
                          </td>
                          <td className="py-1 text-right">
                            <SlipText d={s.slip} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
