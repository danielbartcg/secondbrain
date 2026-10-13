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

export const nodeStatusSchema = z.enum(["OPEN", "WATCH", "CLOSED"]);
export const updateNodeSchema = z.object({
  title: title.optional(),
  notes: z.string().max(500_000).optional(),
  color,
  collapsed: z.boolean().optional(),
  /** Ouvert / à surveiller (mis en évidence) / fermé (hachuré, masqué par défaut). */
  status: nodeStatusSchema.optional(),
  /** Position manuelle sur le canevas ; null = reprend la mise en page automatique. */
  x: z.number().finite().min(-1_000_000).max(1_000_000).nullable().optional(),
  y: z.number().finite().min(-1_000_000).max(1_000_000).nullable().optional(),
});

export const moveNodeSchema = z.object({
  parentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
});

// --- Projets -----------------------------------------------------------------
export const projectStatusSchema = z.enum(["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CLOSED"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const taskComplexitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
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
  priority: taskPrioritySchema.optional(),
  complexity: taskComplexitySchema.optional(),
  startDate: isoDate,
  dueDate: isoDate,
  /** Membre de l'équipe projet affecté. */
  assigneeId: nullableId,
});
/** Création libre : rattachement facultatif (le niveau le plus précis l'emporte) et nœud de carte. */
export const createFreeTaskSchema = createTaskSchema.extend({
  projectId: nullableId,
  stageId: nullableId,
  activityId: nullableId,
  nodeId: nullableId,
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  order: z.number().int().min(0).optional(),
  /**
   * Rattachement : activityId (id) ⇒ étape et projet déduits ; stageId (id) ⇒
   * projet déduit ; projectId (id) ⇒ sans étape ; null détache le niveau et
   * les niveaux inférieurs (projectId: null = tâche sans projet).
   */
  activityId: nullableId,
  stageId: nullableId,
  projectId: nullableId,
});

/** Rattacher une tâche existante à un nœud de carte. */
export const linkNodeTaskSchema = z.object({ taskId: z.string().min(1) });

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

// --- Dossiers et documents ---------------------------------------------------
export const createFolderSchema = z.object({ name: title, parentId: nullableId });
export const updateFolderSchema = z.object({ name: title.optional(), parentId: nullableId });

export const updateDocumentSchema = z.object({
  name: title.optional(),
  deliverableId: nullableId,
  /** Dossier de rangement ; null = racine. */
  folderId: nullableId,
});

// --- Commentaires ------------------------------------------------------------
export const createCommentSchema = z.object({
  /** Texte avec mentions `@[Nom]` ou `@[Nom](memberId)`. */
  body: z.string().trim().min(1, "Commentaire vide").max(10_000),
  /** Commentaire auquel on répond (fil) ; absent = commentaire racine. */
  parentId: nullableId,
});

// --- Organisation personnelle des tâches -------------------------------------
const dayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");
export const createWorkSessionSchema = z.object({ date: dayDate });
export const orderMyTasksSchema = z.object({ taskIds: z.array(z.string().min(1)).max(2_000) });

// --- Prise de notes ------------------------------------------------------------
export const updateNotesSchema = z.object({ notes: z.string().max(500_000) });

// --- Notifications -----------------------------------------------------------
export const updateNotificationSchema = z.object({ read: z.boolean() });

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
export type CreateFreeTaskInput = z.infer<typeof createFreeTaskSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateDeliverableInput = z.infer<typeof createDeliverableSchema>;
export type UpdateDeliverableInput = z.infer<typeof updateDeliverableSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateWorkSessionInput = z.infer<typeof createWorkSessionSchema>;
export type OrderMyTasksInput = z.infer<typeof orderMyTasksSchema>;
