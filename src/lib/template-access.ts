import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

/**
 * Modèles (projets types, cartes types) : exclus des périmètres habituels
 * (`projectAccessWhere`, `mapAccessWhere` filtrent `isTemplate: false`) ;
 * seuls les administrateurs les ouvrent et les modifient, avec les mêmes
 * écrans et les mêmes fonctions métier. Module sans dépendance métier.
 */

type Db = Prisma.TransactionClient | PrismaClient;

/** L'utilisateur est-il administrateur (lecture en base) ? */
export async function isAdminId(userId: string, db: Db = prisma): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
  return !!u && isAdmin(u);
}
