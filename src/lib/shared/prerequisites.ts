/**
 * Tâches prérequises : règles pures partagées par le serveur (projects.ts) et
 * l'application hors ligne (native/src/local/api.ts).
 *
 *  - un prérequis est une autre tâche du **même projet** ;
 *  - pas de dépendance circulaire (A ← B ← … ← A) ;
 *  - une tâche sans projet n'a pas de prérequis.
 */

export type PrereqNode = { id: string; prerequisiteIds: string[] | null | undefined };

/** Message d'erreur (français) si `candidateIds` ne peut pas devenir la liste de prérequis de `taskId`, sinon null. */
export function prerequisiteError(taskId: string, candidateIds: string[], projectTasks: PrereqNode[]): string | null {
  const byId = new Map(projectTasks.map((t) => [t.id, t.prerequisiteIds ?? []]));
  for (const id of candidateIds) {
    if (id === taskId) return "Une tâche ne peut pas être son propre prérequis.";
    if (!byId.has(id)) return "Un prérequis doit être une tâche du même projet.";
  }
  // Cycle : en partant des prérequis proposés, peut-on remonter jusqu'à la tâche elle-même ?
  const seen = new Set<string>();
  const stack = [...candidateIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return "Dépendance circulaire : cette tâche est déjà (indirectement) un prérequis de l'une des tâches choisies.";
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of byId.get(id) ?? []) stack.push(p);
  }
  return null;
}

/** Prérequis non respectés en planning : le prérequis finit après le début de la tâche. */
export function schedulingConflicts(
  task: { startDate: string | null; dueDate: string | null; prerequisiteIds: string[] },
  tasks: Map<string, { name: string; startDate: string | null; dueDate: string | null }>,
): string[] {
  const start = task.startDate ?? task.dueDate;
  if (!start) return [];
  return task.prerequisiteIds
    .map((id) => tasks.get(id))
    .filter((p): p is { name: string; startDate: string | null; dueDate: string | null } => !!p)
    .filter((p) => {
      const end = p.dueDate ?? p.startDate;
      return !!end && end.slice(0, 10) > start.slice(0, 10);
    })
    .map((p) => p.name);
}
