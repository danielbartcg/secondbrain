import { z } from "zod";

/**
 * Schémas de validation de la gestion des risques et opportunités
 * (/api/v1/projects/:id/risks, /api/v1/risks/:riskId…). Documentés dans
 * docs/04-api.md.
 */

const shortId = z.string().min(1).max(64);
const title = z.string().trim().min(1, "Titre requis").max(200);
const longText = z.string().max(20_000);
const level = z.number().int().min(1).max(5);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), "Date invalide")
  .nullable();

export const riskKindSchema = z.enum(["RISK", "OPPORTUNITY"]);
export const riskStatusSchema = z.enum(["OPEN", "MONITORING", "TREATED", "CLOSED"]);

export const createRiskSchema = z.object({
  kind: riskKindSchema.default("RISK"),
  title,
  description: longText.default(""),
  category: z.string().trim().max(80).default(""),
  probability: level.default(3),
  impact: level.default(3),
  status: riskStatusSchema.default("OPEN"),
  /** Responsable : membre (ProjectMember) du même projet. */
  ownerId: shortId.nullable().optional(),
  response: longText.default(""),
  dueDate: day.optional(),
});

export const updateRiskSchema = z.object({
  kind: riskKindSchema.optional(),
  title: title.optional(),
  description: longText.optional(),
  category: z.string().trim().max(80).optional(),
  probability: level.optional(),
  impact: level.optional(),
  status: riskStatusSchema.optional(),
  ownerId: shortId.nullable().optional(),
  response: longText.optional(),
  dueDate: day.optional(),
  order: z.number().int().min(0).max(100_000).optional(),
});

/** Remplace la liste des tâches liées (tâches du même projet). */
export const setRiskTasksSchema = z.object({
  taskIds: z.array(shortId).max(500),
});

export type CreateRiskInput = z.infer<typeof createRiskSchema>;
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;
export type SetRiskTasksInput = z.infer<typeof setRiskTasksSchema>;
