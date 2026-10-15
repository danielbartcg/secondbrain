import "server-only";
import { notFound } from "next/navigation";
import type { User } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";

/**
 * Garde des pages `/admin/**` : à appeler **dans chaque page** (le layout seul
 * ne suffit pas, il peut être sauté par le rendu partiel RSC). 404 si la
 * personne n'est pas administrateur (on ne révèle pas l'existence de la page).
 */
export async function requireAdminPage(): Promise<User> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) notFound();
  return user;
}
