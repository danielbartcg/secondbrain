import "server-only";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";

/**
 * Comptes : profil (prénom, nom, photo, thème), rôles et hiérarchie.
 *
 *  - Administrateur : `User.role = ADMIN`, ou le **super administrateur**
 *    codé en dur (`SUPER_ADMIN_EMAIL`), qui l'est toujours et ne peut pas être
 *    rétrogradé. Un administrateur voit l'administration (utilisateurs, tous
 *    les projets, toutes les tâches) en **lecture**.
 *  - Manager : `User.managerId` désigne le manager (N+1) d'une personne. Un
 *    manager voit, en lecture, les tâches de ses N-1 directs.
 *  - Nom affiché = « Prénom Nom » (`User.name`, recalculé), recopié dans les
 *    fiches membres rattachées au compte.
 */

import { SUPER_ADMIN_EMAIL, isAdmin, isSuperAdmin } from "@/lib/roles";
export { SUPER_ADMIN_EMAIL, isAdmin, isSuperAdmin };

export const THEMES = ["light", "dark", "sepia", "ocean", "forest"] as const;
export type Theme = (typeof THEMES)[number];

export function requireAdmin(user: Pick<User, "email" | "role">): void {
  if (!isAdmin(user)) throw forbidden();
}

/** « Prénom Nom » (ou ce qui existe) ; repli sur l'e-mail. */
export function displayName(firstName: string, lastName: string, fallback: string): string {
  const full = `${firstName.trim()} ${lastName.trim()}`.trim();
  return full || fallback;
}

export function normalizeTheme(theme: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(theme ?? "") ? (theme as Theme) : "light";
}

export type ProfileDto = {
  id: string;
  email: string;
  /** Nom affiché (« Prénom Nom »). */
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  theme: Theme;
  role: UserRole;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  managerId: string | null;
  /** Nombre de N-1 directs (le menu « Mon équipe » n'apparaît que s'il y en a). */
  reportCount: number;
  createdAt: string;
};

export async function getProfile(user: User): Promise<ProfileDto> {
  const reportCount = await prisma.user.count({ where: { managerId: user.id } });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    theme: normalizeTheme(user.theme),
    role: user.role,
    isAdmin: isAdmin(user),
    isSuperAdmin: isSuperAdmin(user),
    managerId: user.managerId,
    reportCount,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Met à jour son profil ; le nom affiché est recopié dans ses fiches membres. */
export async function updateProfile(
  user: User,
  input: { firstName?: string; lastName?: string; avatarUrl?: string | null; theme?: Theme },
): Promise<ProfileDto> {
  const firstName = input.firstName ?? user.firstName;
  const lastName = input.lastName ?? user.lastName;
  if (input.firstName !== undefined || input.lastName !== undefined) {
    if (!firstName.trim() && !lastName.trim()) throw badRequest("Indiquez au moins un prénom ou un nom.");
  }
  const name = displayName(firstName, lastName, user.email);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: user.id },
      data: { firstName, lastName, name, avatarUrl: input.avatarUrl, theme: input.theme },
    });
    if (name !== user.name) await tx.projectMember.updateMany({ where: { userId: user.id }, data: { name } });
    return u;
  });
  return getProfile(updated);
}

// --- Administration ------------------------------------------------------------

export type AdminUserDto = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  managerId: string | null;
  reportIds: string[];
  projectCount: number;
  createdAt: string;
};

export async function listUsersAdmin(): Promise<AdminUserDto[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      managerId: true,
      createdAt: true,
      reports: { select: { id: true } },
      _count: { select: { projects: true, memberships: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    role: u.role,
    isAdmin: isAdmin(u),
    isSuperAdmin: isSuperAdmin(u),
    managerId: u.managerId,
    reportIds: u.reports.map((r) => r.id),
    projectCount: u._count.memberships,
    createdAt: u.createdAt.toISOString(),
  }));
}

/** Rôle et manager d'un utilisateur (réservé aux administrateurs). */
export async function updateUserAdmin(admin: User, targetId: string, input: { role?: UserRole; managerId?: string | null }): Promise<AdminUserDto[]> {
  requireAdmin(admin);
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw notFound("Utilisateur");
  if (input.role !== undefined) {
    if (isSuperAdmin(target)) throw badRequest("Le super administrateur ne peut pas être modifié.");
    if (target.id === admin.id && input.role !== "ADMIN") throw badRequest("Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
  }
  if (input.managerId) {
    if (input.managerId === targetId) throw badRequest("Une personne ne peut pas être son propre manager.");
    const all = await prisma.user.findMany({ select: { id: true, managerId: true } });
    const managerOf = new Map(all.map((u) => [u.id, u.managerId]));
    if (!managerOf.has(input.managerId)) throw notFound("Manager");
    // Interdit : boucle hiérarchique (le futur manager est déjà sous la personne).
    for (let cur: string | null = input.managerId; cur; cur = managerOf.get(cur) ?? null) {
      if (cur === targetId) throw new ApiError(400, "BAD_REQUEST", "Boucle hiérarchique : ce manager dépend déjà de cette personne.");
    }
  }
  await prisma.user.update({ where: { id: targetId }, data: { role: input.role, managerId: input.managerId } });
  return listUsersAdmin();
}

/** Identifiants des N-1 directs. */
export async function reportIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { managerId: userId }, select: { id: true } });
  return rows.map((r) => r.id);
}
