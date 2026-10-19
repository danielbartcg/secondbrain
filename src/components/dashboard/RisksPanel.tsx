"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/client";
import type { RiskOverview, RiskOverviewScope } from "@/lib/risks";
import { RiskBoard } from "@/components/projects/risks/RiskBoard";

const SCOPE_KEY = "sb.dashboard.riskScope";
const SCOPE_LABEL: Record<RiskOverviewScope, string> = { mine: "Risques dont je suis propriétaire", projects: "Tous les risques de mes projets" };

function readScope(): RiskOverviewScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "projects" ? "projects" : "mine";
  } catch {
    return "mine";
  }
}

/**
 * Tableau de bord — matrice des risques (même format que l'onglet Risques
 * d'un projet) : risques non clos dont je suis responsable, ou, si je possède
 * au moins un projet, tous les risques de mes projets (bascule mémorisée sur
 * l'appareil). Un clic sur une case filtre la liste ; une référence ouvre le
 * registre du projet. En ligne : masqué si le serveur est injoignable.
 */
export function RisksPanel() {
  const [scope, setScope] = useState<RiskOverviewScope>("mine");
  const [data, setData] = useState<RiskOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => setScope(readScope()), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<{ overview: RiskOverview }>(`/me/risks?scope=${scope}`)
      .then((r) => alive && setData(r.overview))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope]);


  function pick(next: RiskOverviewScope) {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* préférence non mémorisée */
    }
  }


  if (!data && !loading) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-5 w-5 text-red-500" /> Matrice des risques
          {data && <span className="text-sm font-normal text-muted">{data.risks.length} risque{data.risks.length > 1 ? "s" : ""} ouvert{data.risks.length > 1 ? "s" : ""}</span>}
        </h2>
        {data?.ownsProjects && (
          <div className="inline-flex max-w-full rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label="Risques affichés">
            {(["mine", "projects"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => pick(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${scope === s ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {data?.ownsProjects ? SCOPE_LABEL[scope] : SCOPE_LABEL.mine} · risques non clos des projets actifs ou en pause
      </p>

      {data && (
        <div className="mt-4">
          <RiskBoard
            risks={data.risks}
            hrefOf={(r) => `/projects/${r.projectId}#risques`}
            showProject
            showOwner={scope === "projects"}
            emptyText={scope === "projects" && data.ownsProjects ? "Aucun risque ouvert dans vos projets." : "Aucun risque ouvert dont vous êtes responsable."}
          />
        </div>
      )}
    </section>
  );
}
