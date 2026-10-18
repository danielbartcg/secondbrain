import "server-only";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

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
  /** Adresse validée par le lien reçu par e-mail. */
  emailVerified: boolean;
  /** Copies e-mail des notifications. */
  emailNotifications: boolean;
  /** Fraîcheur : seuil (jours) au-delà duquel une tâche ou un projet sans activité est « endormi ». */
  staleDays: number;
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
    emailVerified: user.emailVerifiedAt !== null,
    emailNotifications: user.emailNotifications,
    staleDays: user.staleDays,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Met à jour son profil ; le nom affiché est recopié dans ses fiches membres. */
export async function updateProfile(
  user: User,
  input: { firstName?: string; lastName?: string; avatarUrl?: string | null; theme?: Theme; emailNotifications?: boolean; staleDays?: number },
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
      data: { firstName, lastName, name, avatarUrl: input.avatarUrl, theme: input.theme, emailNotifications: input.emailNotifications, staleDays: input.staleDays },
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
  /** Adresse e-mail validée (lien reçu par e-mail) ; informatif. */
  emailVerified: boolean;
  createdAt: string;
};

export async function listUsersAdmin(admin: Pick<User, "email" | "role">): Promise<AdminUserDto[]> {
  requireAdmin(admin);
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
      emailVerifiedAt: true,
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
    emailVerified: u.emailVerifiedAt !== null,
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
  return listUsersAdmin(admin);
}

/**
 * Création d'un compte par un administrateur, avec un mot de passe imposé
 * (à communiquer à la personne par un canal sûr). Le super administrateur ne
 * se crée jamais ainsi (seulement par `scripts/create-user.ts`). L'adresse
 * n'est pas marquée validée. Renvoie la liste à jour.
 */
export async function createUserAdmin(
  admin: User,
  input: { email: string; firstName: string; lastName: string; password: string; role?: UserRole; managerId?: string | null },
): Promise<AdminUserDto[]> {
  requireAdmin(admin);
  const email = input.email.trim().toLowerCase();
  const taken = () => new ApiError(409, "EMAIL_TAKEN", "Un compte existe déjà avec cet e-mail.");
  if (isSuperAdmin({ email })) throw taken();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw taken();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName && !lastName) throw badRequest("Indiquez au moins un prénom ou un nom.");
  if (input.managerId) {
    const manager = await prisma.user.findUnique({ where: { id: input.managerId }, select: { id: true } });
    if (!manager) throw notFound("Manager");
  }
  const passwordHash = await hashPassword(input.password);
  try {
    await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        name: displayName(firstName, lastName, email),
        passwordHash,
        role: input.role ?? "USER",
        managerId: input.managerId ?? null,
        emailVerifiedAt: null,
      },
    });
  } catch (e) {
    // Course entre deux créations simultanées : contrainte d'unicité de l'e-mail.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") throw taken();
    throw e;
  }
  return listUsersAdmin(admin);
}

/**
 * Mot de passe imposé par un administrateur : remplace l'empreinte et ferme
 * toutes les sessions de la personne (web, applications). Seul le super
 * administrateur peut réinitialiser son propre mot de passe par cette voie.
 */
export async function setUserPasswordAdmin(admin: User, targetId: string, password: string): Promise<void> {
  requireAdmin(admin);
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, email: true } });
  if (!target) throw notFound("Utilisateur");
  if (isSuperAdmin(target) && !isSuperAdmin(admin)) throw forbidden();
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: targetId } }),
  ]);
}

/** Identifiants des N-1 directs. */
export async function reportIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { managerId: userId }, select: { id: true } });
  return rows.map((r) => r.id);
}
