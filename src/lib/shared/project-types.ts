/**
 * Types de projet personnels (règles pures : écrans, menu, application).
 * `assignments` : projectId → typeId (projets absents = sans type).
 */

export type ProjectTypeDto = { id: string; name: string };
export type ProjectTypesDto = { types: ProjectTypeDto[]; assignments: Record<string, string> };

export const EMPTY_PROJECT_TYPES: ProjectTypesDto = { types: [], assignments: {} };

/** Au-delà de ce nombre de projets épinglés, le menu les groupe par type. */
export const PIN_GROUP_THRESHOLD = 5;

export type TypeGroup<T> = { type: ProjectTypeDto | null; items: T[] };

/**
 * Regroupe des projets par type : d'abord les projets sans type (`type: null`),
 * puis chaque type dans l'ordre choisi. `keepEmpty` : garder les types sans
 * projet (zones de dépôt de la liste des projets).
 */
export function groupByType<T extends { id: string }>(items: T[], data: ProjectTypesDto, keepEmpty = false): TypeGroup<T>[] {
  const known = new Set(data.types.map((t) => t.id));
  const typeOf = (id: string) => (known.has(data.assignments[id]) ? data.assignments[id] : null);
  const groups: TypeGroup<T>[] = [{ type: null, items: items.filter((p) => typeOf(p.id) === null) }];
  for (const t of data.types) {
    const its = items.filter((p) => typeOf(p.id) === t.id);
    if (its.length || keepEmpty) groups.push({ type: t, items: its });
  }
  return groups;
}

/** Déplace un élément d'une liste d'identifiants (avant `beforeId`, ou en fin si null). */
export function moveId(ids: string[], id: string, beforeId: string | null): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId ? rest.indexOf(beforeId) : -1;
  if (at < 0) return [...rest, id];
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Déplace `id` juste avant ou juste après `targetId` (glisser-déposer). */
export function moveRelative(ids: string[], id: string, targetId: string, position: "before" | "after"): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(targetId);
  if (at < 0) return [...rest, id];
  const i = position === "before" ? at : at + 1;
  return [...rest.slice(0, i), id, ...rest.slice(i)];
}
