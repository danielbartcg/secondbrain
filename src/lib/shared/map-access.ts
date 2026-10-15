/**
 * Droits sur une carte mentale (module pur, partagé serveur / application).
 *
 *  - owner : propriétaire — tout, y compris supprimer la carte et gérer les partages ;
 *  - write : partagée en écriture — contenu de la carte (nœuds, notes, tâches rattachées) ;
 *  - read  : partagée en lecture — consultation seule.
 */

export type MapAccess = "owner" | "write" | "read";
export type MapPermission = "READ" | "WRITE";

/** Personne qui a partagé la carte (null quand je suis le propriétaire). */
export type MapOwnerRef = { id: string; name: string; avatarUrl: string | null };

const RANK: Record<MapAccess, number> = { read: 0, write: 1, owner: 2 };

/** Droit effectif d'un utilisateur, d'après le propriétaire et son éventuel partage. */
export function mapAccessOf(ownerId: string, userId: string, permission: MapPermission | null | undefined): MapAccess | null {
  if (ownerId === userId) return "owner";
  if (permission === "WRITE") return "write";
  if (permission === "READ") return "read";
  return null;
}

/** Vrai si `access` suffit pour le niveau demandé. */
export function mapAllows(access: MapAccess, level: MapAccess): boolean {
  return RANK[access] >= RANK[level];
}

export const MAP_PERMISSION_LABEL: Record<MapPermission, string> = { READ: "Lecture", WRITE: "Écriture" };
