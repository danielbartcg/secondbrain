/**
 * Planning de référence (baseline) : types partagés serveur / écrans. La
 * comparaison avec le planning réel (étendues, glissements) est calculée
 * côté client par le modèle pur du Gantt (`baselineSpans`, `stageSlips`).
 */

export type BaselineStage = { id: string; name: string; startDate: string | null; dueDate: string | null };
export type BaselineTask = { id: string; name: string; stageId: string | null; startDate: string | null; dueDate: string | null };
export type BaselineData = { stages: BaselineStage[]; tasks: BaselineTask[] };

export type BaselineSummary = {
  id: string;
  name: string;
  createdAt: string;
  createdById: string | null;
  createdByName: string;
  /** Tâches datées au moment de l'instantané. */
  taskCount: number;
};

export type BaselineDto = BaselineSummary & { data: BaselineData };
