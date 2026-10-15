import { z } from "zod";

/** Validation des partages de cartes mentales (docs/04-api.md « Partage des cartes »). */

export const mapPermissionSchema = z.enum(["READ", "WRITE"]);

const cuidLike = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide");

/** POST /api/v1/mindmaps/:id/shares — destinataire par identifiant (contacts) ou par e-mail exact. */
export const createMapShareSchema = z
  .object({
    userId: cuidLike.optional(),
    email: z.string().trim().toLowerCase().email("E-mail invalide").max(254).optional(),
    permission: mapPermissionSchema.default("READ"),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), { message: "Indiquez soit userId, soit email.", path: ["userId"] });

/** PATCH /api/v1/mindmaps/:id/shares/:userId */
export const updateMapShareSchema = z.object({ permission: mapPermissionSchema });

export type CreateMapShareInput = z.infer<typeof createMapShareSchema>;
export type UpdateMapShareInput = z.infer<typeof updateMapShareSchema>;
