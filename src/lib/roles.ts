/**
 * Rôles (sans dépendance : importable partout, y compris par `auth.ts`).
 * Le super administrateur est désigné par son e-mail (codé en dur, ou
 * `SUPER_ADMIN_EMAIL` dans l'environnement serveur) : il est toujours
 * administrateur et ne peut pas être rétrogradé. Ce compte ne peut **pas** être
 * créé par l'inscription publique (`/api/v1/auth/register` le refuse) : seulement
 * par `scripts/create-user.ts`.
 */
const DEFAULT_SUPER_ADMIN_EMAIL = "daniel.barral@outlook.com";

export const SUPER_ADMIN_EMAIL = (
  (typeof process !== "undefined" && process.env?.SUPER_ADMIN_EMAIL) ||
  DEFAULT_SUPER_ADMIN_EMAIL
)
  .trim()
  .toLowerCase();

export function isSuperAdmin(user: { email: string }): boolean {
  return user.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isAdmin(user: { email: string; role: string }): boolean {
  return isSuperAdmin(user) || user.role === "ADMIN";
}
