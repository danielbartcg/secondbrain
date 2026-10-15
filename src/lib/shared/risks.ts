/**
 * Règles pures de la gestion des risques et opportunités : criticité
 * (probabilité × gravité / bénéfice), niveau et libellés. Sans dépendance :
 * partagé entre le serveur (`src/lib/risks.ts`) et l'interface.
 */

export type RiskKindValue = "RISK" | "OPPORTUNITY";
export type RiskStatusValue = "OPEN" | "MONITORING" | "TREATED" | "CLOSED";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"];

/** Criticité = probabilité × impact (1..25). */
export function riskScore(probability: number, impact: number): number {
  return probability * impact;
}

/** ≤ 4 faible, ≤ 9 modéré, ≤ 15 élevé, au-delà critique. */
export function riskLevel(score: number): RiskLevel {
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 15) return "high";
  return "critical";
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = { low: "Faible", medium: "Modéré", high: "Élevé", critical: "Critique" };
export const OPPORTUNITY_LEVEL_LABEL: Record<RiskLevel, string> = { low: "Faible", medium: "Moyenne", high: "Forte", critical: "Majeure" };

export function levelLabel(kind: RiskKindValue, level: RiskLevel): string {
  return (kind === "OPPORTUNITY" ? OPPORTUNITY_LEVEL_LABEL : RISK_LEVEL_LABEL)[level];
}

export const RISK_STATUS_LABEL: Record<RiskStatusValue, string> = {
  OPEN: "Ouvert",
  MONITORING: "Sous surveillance",
  TREATED: "Traité",
  CLOSED: "Clos",
};
export const RISK_STATUSES: readonly RiskStatusValue[] = ["OPEN", "MONITORING", "TREATED", "CLOSED"];

export const KIND_NOUN: Record<RiskKindValue, { def: string; to: string; indef: string; label: string; prefix: string }> = {
  RISK: { def: "le risque", to: "au risque", indef: "un risque", label: "Risque", prefix: "R" },
  OPPORTUNITY: { def: "l'opportunité", to: "à l'opportunité", indef: "une opportunité", label: "Opportunité", prefix: "O" },
};

/** Échelles des axes de la matrice (index 0 = niveau 1). */
export const PROBABILITY_LABELS = ["Rare", "Peu probable", "Possible", "Probable", "Quasi certain"] as const;
export const SEVERITY_LABELS = ["Négligeable", "Mineure", "Modérée", "Majeure", "Critique"] as const;
export const BENEFIT_LABELS = ["Faible", "Limité", "Moyen", "Important", "Majeur"] as const;
