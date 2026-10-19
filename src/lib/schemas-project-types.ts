import { z } from "zod";

/** Schémas des types de projet personnels (docs/04-api.md). */

const id = z.string().min(1).max(64);
export const projectTypeNameSchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(60) });
export const projectTypeOrderSchema = z.object({ ids: z.array(id).max(50) });
export const projectTypeAssignSchema = z.object({ projectId: id, typeId: id.nullable() });
