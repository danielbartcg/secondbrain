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
/** Identifiant (cuid) : longueur bornée. */
const shortId = z.string().min(1).max(64);
const nullableId = shortId.nullable().optional();
/** bcrypt ne considère que les 72 premiers octets : on borne le mot de passe choisi. */
const newPassword = z
  .string()
  .min(8, "8 caractères minimum")
  .max(72, "72 caractères maximum")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "72 caractères maximum");

// --- Authentification --------------------------------------------------------
export const registerSchema = z
  .object({
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
  password: newPassword,
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  /** Ancien champ unique (applications existantes) : devient le prénom. */
  name: z.string().trim().max(100).optional(),
  /** Libellé du client (« iPhone »…) : utile aux applications mobiles. */
  client: z.string().trim().max(100).optional(),
  /** Confirmation (facultative côté API, vérifiée si fournie). */
  confirmPassword: z.string().max(200).optional(),
})
  .refine((v) => v.firstName || v.lastName || v.name, { message: "Prénom ou nom requis", path: ["firstName"] })
  .refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.password, { message: "La confirmation ne correspond pas", path: ["confirmPassword"] });

// --- Profil et administration ------------------------------------------------
export const themeSchema = z.enum(["light", "dark", "sepia", "ocean", "forest"]);
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis").max(200),
    newPassword,
    /** Confirmation (facultative côté API, vérifiée si fournie). */
    confirmPassword: z.string().max(200).optional(),
  })
  .refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.newPassword, { message: "La confirmation ne correspond pas", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Le nouveau mot de passe doit être différent de l'actuel", path: ["newPassword"] });

export const updateProfileSchema = z.object({
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  /** Photo téléversée via /uploads (URL /media/…) ; null = silhouette. */
  avatarUrl: z
    .string()
    .regex(/^\/media\/[A-Za-z0-9/_-]+\.(jpg|jpeg|png|gif|webp)$/, "Photo invalide")
    .nullable()
    .optional(),
  theme: themeSchema.optional(),
  /** Copies e-mail des notifications. */
  emailNotifications: z.boolean().optional(),
});
export const adminUpdateUserSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  managerId: nullableId,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
  password: z.string().min(1, "Mot de passe requis").max(200),
  client: z.string().trim().max(100).optional(),
});

// --- Cartes mentales ---------------------------------------------------------
export const createMindMapSchema = z.object({ title });

// --- Modèles (projets types, cartes types) ----------------------------------------
const templateId = z.string().min(1).max(64);
/** Création à partir d'un modèle (facultatif). */
export const createProjectFromTemplateSchema = z.object({ templateId: templateId.nullable().optional() });
export const createMindMapFromTemplateSchema = z.object({ templateId: templateId.nullable().optional() });
export const applyTemplateSchema = z.object({ templateId });
export const createProjectTemplateSchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(200), fromProjectId: templateId.nullable().optional() });
export const createMapTemplateSchema = z.object({ title: z.string().trim().min(1, "Titre requis").max(200), fromMapId: templateId.nullable().optional() });
export const updateMindMapSchema = z.object({ title: title.optional() });

export const createNodeSchema = z.object({
  parentId: shortId,
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
  parentId: shortId,
  index: z.number().int().min(0).optional(),
});

// --- Projets -----------------------------------------------------------------
export const projectStatusSchema = z.enum(["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CLOSED"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const taskComplexitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const deliverableStatusSchema = z.enum(["PLANNED", "IN_PROGRESS", "DELIVERED", "VALIDATED"]);

/** Valeurs de champs personnalisés : { fieldId: texte | id d'option | null (vider) } — fusion. */
export const customValuesPatchSchema = z
  .record(z.string().min(1).max(64), z.string().max(500).nullable())
  .refine((r) => Object.keys(r).length <= 50, "50 champs au plus");

export const createProjectSchema = z.object({
  name: title,
  description: longText,
  color,
  status: projectStatusSchema.optional(),
  startDate: isoDate,
  dueDate: isoDate,
  customFields: customValuesPatchSchema.optional(),
});

// --- Champs personnalisés (administration) ----------------------------------------
const customOption = z.object({ id: z.string().max(64).optional(), label: z.string().trim().min(1, "Valeur vide").max(100) });
export const customFieldSchema = z.object({
  label: z.string().trim().min(1, "Libellé requis").max(60),
  type: z.enum(["TEXT", "LIST"]),
  options: z.array(customOption).max(500).optional(),
});
export const customFieldUpdateSchema = z.object({
  label: z.string().trim().min(1, "Libellé requis").max(60).optional(),
  active: z.boolean().optional(),
  options: z.array(customOption).max(500).optional(),
  order: z.number().int().min(0).max(1000).optional(),
});
export type CustomFieldInput = z.infer<typeof customFieldSchema>;
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;
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
  /** Membre de l'équipe projet affecté (responsable). */
  assigneeId: nullableId,
  /** Superviseur : un seul membre. */
  supervisorId: nullableId,
  /** Contributeurs : liste de membres (remplace la liste existante). */
  contributorIds: z.array(shortId).max(100).optional(),
  /** Tâches prérequises (même projet, sans cycle ; remplace la liste existante). */
  prerequisiteIds: z.array(shortId).max(100).optional(),
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
  /** Date de clôture (modifiable seulement sur une tâche clôturée). */
  closedAt: isoDate,
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
export const linkNodeTaskSchema = z.object({ taskId: shortId });

// --- Équipe ------------------------------------------------------------------
export const createMemberSchema = z
  .object({
    /** Compte de l'application à inviter (prioritaire sur name/email). */
    userId: shortId.optional(),
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
export const orderMyTasksSchema = z.object({ taskIds: z.array(shortId).max(2_000) });

// --- Synchronisation hors ligne ---------------------------------------------------
export const SYNC_ENTITIES = [
  "MindMap",
  "MindNode",
  "MindNodeTask",
  "Project",
  "Stage",
  "Activity",
  "Task",
  "TaskContributor",
  "WorkSession",
  "TaskComment",
] as const;
export const syncPushSchema = z.object({
  ops: z
    .array(
      z.object({
        /** Identifiant unique de l'opération (idempotence). */
        opId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
        entity: z.enum(SYNC_ENTITIES),
        /** Identifiant de l'objet ; composite « a:b » pour MindNodeTask (nodeId:taskId) et TaskContributor (taskId:memberId). */
        id: z.string().min(1).max(120),
        op: z.enum(["create", "update", "delete"]),
        fields: z
          .record(z.unknown())
          .refine((f) => Object.keys(f).length <= 50, "50 champs maximum")
          .refine(
            (f) => Object.entries(f).every(([k, v]) => k.length <= 64 && (typeof v !== "string" || v.length <= 500_000)),
            "Champ trop long",
          )
          .optional(),
        /** Version (seq) connue de chaque champ modifié ; "*" = version de l'objet entier. */
        base: z.record(z.number().int().min(0)).refine((b) => Object.keys(b).length <= 51, "Trop de champs").optional(),
      }),
    )
    .max(500),
});
export type SyncOpInput = z.infer<typeof syncPushSchema>["ops"][number];

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

// --- Administration → Notifications --------------------------------------------------------
const notificationTypeSchema = z.enum(["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE", "MEETING_REVIEW", "MEETING_DECISION", "MAP_SHARED"]);
export const notificationSettingsSchema = z.object({
  smtpHost: z.string().trim().max(253).regex(/^[A-Za-z0-9.-]*$/, "Nom d'hôte SMTP invalide").optional(),
  smtpPort: z.number().int().min(1).max(65_535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(254).optional(),
  smtpPassword: z.string().max(500).optional(),
  smtpFrom: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^<>\r\n]*<?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(v), "Adresse d'expédition invalide (ex. Second Brain <noreply@exemple.fr>)")
    .optional(),
  emailEnabled: z.boolean().optional(),
  types: z.array(z.object({ type: notificationTypeSchema, enabled: z.boolean(), email: z.boolean() })).max(20).optional(),
});

// --- Messagerie --------------------------------------------------------------------------------
const id = z.string().min(1).max(64);
const messageBody = z.string().max(100_000);
export const createConversationSchema = z.object({
  participantIds: z.array(id).min(1, "Choisissez au moins un destinataire").max(50),
  title: z.string().trim().max(120).optional(),
  body: messageBody.optional(),
});
export const postMessageSchema = z.object({ body: messageBody, replyToId: id.nullable().optional() });
export const conversationReadSchema = z.object({ read: z.boolean() });

// --- E-mails de compte ---------------------------------------------------------------------------
const emailAddress = z.string().trim().toLowerCase().email("E-mail invalide").max(200);
const emailToken = z.string().min(10).max(200);
export const forgotPasswordSchema = z.object({ email: emailAddress });
export const resetPasswordSchema = z
  .object({ token: emailToken, password: newPassword, confirmPassword: z.string().max(200).optional() })
  .refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.password, { message: "La confirmation ne correspond pas", path: ["confirmPassword"] });
export const verifyEmailSchema = z.object({ token: emailToken });
export const changeEmailSchema = z.object({ email: emailAddress, currentPassword: z.string().min(1, "Mot de passe actuel requis").max(200) });

// --- Clés d'accès (connecteur MCP) ---------------------------------------------------------------
export const createApiKeySchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(80), canWrite: z.boolean().default(true) });

// --- Épingles du menu ------------------------------------------------------------------------------
export const setPinSchema = z.object({ kind: z.enum(["PROJECT", "MINDMAP"]), id: z.string().min(1).max(64), pinned: z.boolean() });
