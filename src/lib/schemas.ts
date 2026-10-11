import { z } from "zod";

/**
 * Schémas de validation de l'API /api/v1 (zod). Partagés entre les route
 * handlers et les formulaires web ; documentés dans docs/04-api.md.
 */

const title = z.string().trim().min(1, "Titre requis").max(200);
const longText = z.string().max(20_000).default("");
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #rrggbb")
  .nullable()
  .optional();
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .nullable()
  .optional();
const nullableId = z.string().min(1).nullable().optional();

// --- Authentification --------------------------------------------------------
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
  password: z.string().min(8, "8 caractères minimum").max(200),
  name: z.string().trim().min(1, "Nom requis").max(100),
  /** Libellé du client (« iPhone »…) : utile aux applications mobiles. */
  client: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
  password: z.string().min(1, "Mot de passe requis").max(200),
  client: z.string().trim().max(100).optional(),
});

// --- Cartes mentales ---------------------------------------------------------
export const createMindMapSchema = z.object({ title });
export const updateMindMapSchema = z.object({ title: title.optional() });

export const createNodeSchema = z.object({
  parentId: z.string().min(1),
  title: title.default("Nouvelle idée"),
  /** Position parmi les frères ; absent = à la fin. */
  index: z.number().int().min(0).optional(),
});

export const updateNodeSchema = z.object({
  title: title.optional(),
  notes: z.string().max(500_000).optional(),
  color,
  collapsed: z.boolean().optional(),
});

export const moveNodeSchema = z.object({
  parentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
});

// --- Projets -----------------------------------------------------------------
export const projectStatusSchema = z.enum(["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export const deliverableStatusSchema = z.enum(["PLANNED", "IN_PROGRESS", "DELIVERED", "VALIDATED"]);

export const createProjectSchema = z.object({
  name: title,
  description: longText,
  color,
  status: projectStatusSchema.optional(),
  startDate: isoDate,
  dueDate: isoDate,
});
export const updateProjectSchema = createProjectSchema.partial();

export const createStageSchema = z.object({
  name: title,
  description: longText,
  startDate: isoDate,
  dueDate: isoDate,
});
export const updateStageSchema = createStageSchema.partial().extend({
  order: z.number().int().min(0).optional(),
});

export const createActivitySchema = z.object({ name: title, description: longText });
export const updateActivitySchema = createActivitySchema.partial().extend({
  order: z.number().int().min(0).optional(),
});

export const createTaskSchema = z.object({
  name: title,
  description: longText,
  status: taskStatusSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  startDate: isoDate,
  dueDate: isoDate,
  /** Membre de l'équipe projet affecté. */
  assigneeId: nullableId,
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  order: z.number().int().min(0).optional(),
  /** Déplacer la tâche : vers une activité (id) ou directement sous l'étape (null). */
  activityId: nullableId,
  stageId: z.string().min(1).optional(),
});

// --- Équipe ------------------------------------------------------------------
export const createMemberSchema = z
  .object({
    /** Compte de l'application à inviter (prioritaire sur name/email). */
    userId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
    role: z.string().trim().max(100).nullable().optional(),
    color,
  })
  .refine((v) => v.userId || v.name, { message: "userId ou name requis", path: ["name"] });
export const updateMemberSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  role: z.string().trim().max(100).nullable().optional(),
  color,
});

// --- Livrables ---------------------------------------------------------------
export const createDeliverableSchema = z.object({
  name: title,
  description: longText,
  status: deliverableStatusSchema.optional(),
  stageId: nullableId,
  assigneeId: nullableId,
  expectedStart: isoDate,
  expectedEnd: isoDate,
  deliveredAt: isoDate,
});
export const updateDeliverableSchema = createDeliverableSchema.partial().extend({
  order: z.number().int().min(0).optional(),
});

// --- Documents ---------------------------------------------------------------
export const updateDocumentSchema = z.object({
  name: title.optional(),
  deliverableId: nullableId,
});

// --- Commentaires ------------------------------------------------------------
export const createCommentSchema = z.object({
  /** Texte avec mentions `@[Nom](memberId)`. */
  body: z.string().trim().min(1, "Commentaire vide").max(10_000),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type MoveNodeInput = z.infer<typeof moveNodeSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateDeliverableInput = z.infer<typeof createDeliverableSchema>;
export type UpdateDeliverableInput = z.infer<typeof updateDeliverableSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
