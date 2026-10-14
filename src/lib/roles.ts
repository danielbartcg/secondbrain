/**
 * Rôles (sans dépendance : importable partout, y compris par `auth.ts`).
 * Le super administrateur est codé en dur : il est toujours administrateur et
 * ne peut pas être rétrogradé.
 */
export const SUPER_ADMIN_EMAIL = "daniel.barral@outlook.com";

export function isSuperAdmin(user: { email: string }): boolean {
  return user.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isAdmin(user: { email: string; role: string }): boolean {
  return isSuperAdmin(user) || user.role === "ADMIN";
}
