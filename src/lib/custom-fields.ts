import "server-only";
import { randomBytes } from "node:crypto";
import type { CustomField, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { requireAdmin } from "@/lib/users";
import { MAX_CUSTOM_FIELDS, MAX_CUSTOM_OPTIONS, readOptions, sortOptions, type CustomFieldDto } from "@/lib/shared/custom-fields";
import type { CustomFieldInput, CustomFieldUpdateInput } from "@/lib/schemas";

/**
 * Champs personnalisés des projets (Administration → Champs personnalisés).
 * Définitions globales gérées par les administrateurs ; tout utilisateur
 * connecté les lit (fiches projet). Les valeurs vivent dans
 * `Project.customFields` (synchronisé avec l'application comme les autres
 * colonnes). Supprimer un champ ou une option efface les valeurs
 * correspondantes des projets (dans la même transaction).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const newOptionId = () => "o" + randomBytes(6).toString("hex");

export function toCustomFieldDto(f: CustomField): CustomFieldDto {
  return { id: f.id, label: f.label, type: f.type, options: readOptions(f.options), optionSort: f.optionSort, order: f.order, active: f.active };
}

/** Définitions (actives seulement, sauf pour l'administration). */
export async function listCustomFields(opts: { includeArchived?: boolean } = {}, db: Db = prisma): Promise<CustomFieldDto[]> {
  const rows = await db.customField.findMany({ where: opts.includeArchived ? {} : { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(toCustomFieldDto);
}

/** Toutes les définitions (y compris archivées) : validation des valeurs. */
export async function allCustomFields(db: Db = prisma): Promise<CustomFieldDto[]> {
  return listCustomFields({ includeArchived: true }, db);
}

/** Options normalisées : libellés uniques, identifiants conservés, nouveaux générés. */
function normalizeOptions(input: { id?: string; label: string }[], previous: { id: string; label: string }[] = []): { id: string; label: string }[] {
  const known = new Set(previous.map((o) => o.id));
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const o of input) {
    const label = o.label.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) throw badRequest(`La valeur « ${label} » est en double.`);
    seen.add(key);
    out.push({ id: o.id && known.has(o.id) ? o.id : newOptionId(), label });
  }
  if (out.length > MAX_CUSTOM_OPTIONS) throw badRequest(`${MAX_CUSTOM_OPTIONS} valeurs au plus.`);
  return out;
}

export async function createCustomField(admin: Pick<User, "email" | "role">, input: CustomFieldInput): Promise<CustomFieldDto[]> {
  requireAdmin(admin);
  if ((await prisma.customField.count()) >= MAX_CUSTOM_FIELDS) throw badRequest(`${MAX_CUSTOM_FIELDS} champs au plus.`);
  const last = await prisma.customField.aggregate({ _max: { order: true } });
  await prisma.customField.create({
    data: {
      label: input.label.trim(),
      type: input.type,
      options: input.type === "LIST" ? sortOptions(normalizeOptions(input.options ?? []), input.optionSort ?? "MANUAL") : [],
      optionSort: input.optionSort ?? "MANUAL",
      order: (last._max.order ?? -1) + 1,
    },
  });
  return listCustomFields({ includeArchived: true });
}

export async function updateCustomField(admin: Pick<User, "email" | "role">, id: string, input: CustomFieldUpdateInput): Promise<CustomFieldDto[]> {
  requireAdmin(admin);
  await prisma.$transaction(async (tx) => {
    const field = await tx.customField.findUnique({ where: { id } });
    if (!field) throw notFound("Champ");
    const data: Prisma.CustomFieldUpdateInput = {};
    if (input.label !== undefined) data.label = input.label.trim();
    if (input.active !== undefined) data.active = input.active;
    const sort = input.optionSort ?? field.optionSort;
    if (input.optionSort !== undefined) {
      if (field.type !== "LIST") throw badRequest("Seul un champ « liste » a des valeurs.");
      data.optionSort = input.optionSort;
      // Tri forcé : les valeurs existantes sont rangées tout de suite.
      if (input.options === undefined) data.options = sortOptions(readOptions(field.options), sort);
    }
    if (input.options !== undefined) {
      if (field.type !== "LIST") throw badRequest("Seul un champ « liste » a des valeurs.");
      const previous = readOptions(field.options);
      const next = sortOptions(normalizeOptions(input.options, previous), sort);
      data.options = next;
      // Valeurs retirées : effacées des projets (synchronisé : déclencheur sur Project).
      const removed = previous.map((o) => o.id).filter((oid) => !next.some((n) => n.id === oid));
      if (removed.length) {
        await tx.$executeRaw`UPDATE "Project" SET "customFields" = "customFields" - ${id}::text WHERE "customFields"->>${id}::text = ANY(${removed}::text[])`;
      }
    }
    if (input.order !== undefined) {
      // Déplacer : renuméroter tous les champs.
      const all = await tx.customField.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const ids = all.map((f) => f.id).filter((x) => x !== id);
      ids.splice(Math.min(Math.max(0, input.order), ids.length), 0, id);
      for (let i = 0; i < ids.length; i++) if (ids[i] !== id) await tx.customField.update({ where: { id: ids[i] }, data: { order: i } });
      data.order = ids.indexOf(id);
    }
    await tx.customField.update({ where: { id }, data });
  });
  return listCustomFields({ includeArchived: true });
}

/** Suppression définitive : la valeur disparaît de tous les projets. */
export async function deleteCustomField(admin: Pick<User, "email" | "role">, id: string): Promise<CustomFieldDto[]> {
  requireAdmin(admin);
  await prisma.$transaction(async (tx) => {
    const removed = await tx.customField.deleteMany({ where: { id } });
    if (removed.count === 0) throw notFound("Champ");
    await tx.$executeRaw`UPDATE "Project" SET "customFields" = "customFields" - ${id}::text WHERE "customFields" ? ${id}::text`;
  });
  return listCustomFields({ includeArchived: true });
}

/**
 * Nombre de projets renseignés (administration) : par champ (`fieldId`) et,
 * pour les listes, par valeur (`fieldId/optionId`).
 */
export async function customFieldUsage(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ key: string; value: string; n: bigint }>>`SELECT e.key AS "key", e.value AS "value", COUNT(*) AS n FROM "Project", jsonb_each_text("customFields") AS e GROUP BY e.key, e.value`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.key] = (out[r.key] ?? 0) + Number(r.n);
    out[`${r.key}/${r.value}`] = Number(r.n);
  }
  return out;
}
