import { z } from "zod";

/**
 * Schémas zod de l'administration des comptes (création d'un compte et
 * réinitialisation forcée du mot de passe par un administrateur).
 */

/** bcrypt ne considère que les 72 premiers octets : même règle que `newPassword` (schemas.ts). */
const adminPassword = z
  .string()
  .min(8, "8 caractères minimum")
  .max(72, "72 caractères maximum")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "72 caractères maximum");

const personName = z.string().trim().max(60, "60 caractères maximum");

export const adminCreateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
    firstName: personName.default(""),
    lastName: personName.default(""),
    password: adminPassword,
    role: z.enum(["USER", "ADMIN"]).default("USER"),
    managerId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((v) => v.firstName !== "" || v.lastName !== "", { message: "Indiquez au moins un prénom ou un nom.", path: ["firstName"] });

export const adminSetPasswordSchema = z.object({ password: adminPassword });

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminSetPasswordInput = z.infer<typeof adminSetPasswordSchema>;
