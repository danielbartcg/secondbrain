/**
 * Champs personnalisés des projets (règles pures : serveur, interface,
 * application, export, connecteur MCP). Définis dans Administration → Champs
 * personnalisés ; un projet stocke `{ [fieldId]: valeur }` — le texte saisi,
 * ou l'identifiant de l'option choisie pour une liste.
 */

export type CustomFieldTypeValue = "TEXT" | "LIST";
export type CustomFieldOption = { id: string; label: string };
/** Tri des valeurs d'une liste : manuel (glisser-déposer) ou forcé A → Z / Z → A. */
export type CustomOptionSortValue = "MANUAL" | "ASC" | "DESC";
export type CustomFieldDto = { id: string; label: string; type: CustomFieldTypeValue; options: CustomFieldOption[]; optionSort: CustomOptionSortValue; order: number; active: boolean };
export type CustomValues = Record<string, string>;

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldTypeValue, string> = { TEXT: "Texte libre", LIST: "Liste de valeurs" };
export const OPTION_SORT_LABEL: Record<CustomOptionSortValue, string> = { MANUAL: "Ordre manuel", ASC: "A → Z", DESC: "Z → A" };
export const MAX_CUSTOM_FIELDS = 50;

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
/** Valeurs rangées selon le tri du champ (MANUAL : ordre inchangé). */
export function sortOptions<T extends { label: string }>(options: T[], sort: CustomOptionSortValue): T[] {
  if (sort === "MANUAL") return options;
  const sorted = [...options].sort((a, b) => collator.compare(a.label, b.label));
  return sort === "DESC" ? sorted.reverse() : sorted;
}
export const MAX_CUSTOM_OPTIONS = 500;
export const MAX_CUSTOM_TEXT = 500;

/** Objet JSON stocké → valeurs propres (chaînes non vides uniquement). */
export function readCustomValues(raw: unknown): CustomValues {
  const out: CustomValues = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && v.trim()) out[k] = v;
  return out;
}

/** Options d'une liste (JSON stocké → liste propre). */
export function readOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is CustomFieldOption => !!o && typeof o === "object" && typeof (o as CustomFieldOption).id === "string" && typeof (o as CustomFieldOption).label === "string");
}

/** Valeur affichée d'un champ pour un projet ("" si vide ; « valeur retirée » si l'option n'existe plus). */
export function customValueLabel(field: Pick<CustomFieldDto, "type" | "options">, raw: string | undefined | null): string {
  if (!raw) return "";
  if (field.type === "TEXT") return raw;
  return field.options.find((o) => o.id === raw)?.label ?? "(valeur retirée)";
}

/** Champs renseignés d'un projet, dans l'ordre de l'administration : [{ label, value }]. */
export function customEntries(fields: CustomFieldDto[], values: CustomValues): { id: string; label: string; value: string }[] {
  return fields
    .filter((f) => values[f.id])
    .map((f) => ({ id: f.id, label: f.label, value: customValueLabel(f, values[f.id]) }));
}

/**
 * Applique une modification (`patch` : fieldId → valeur, null ou "" = vider)
 * à des valeurs existantes en validant contre les définitions. Renvoie les
 * nouvelles valeurs, ou un message d'erreur (français).
 */
export function applyCustomPatch(fields: CustomFieldDto[], current: CustomValues, patch: Record<string, string | null>): { values: CustomValues } | { error: string } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const values: CustomValues = { ...current };
  for (const [id, rawValue] of Object.entries(patch)) {
    const field = byId.get(id);
    if (!field) return { error: "Champ personnalisé inconnu." };
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) {
      delete values[id];
      continue;
    }
    if (!field.active) return { error: `Le champ « ${field.label} » est archivé.` };
    if (field.type === "LIST") {
      // Identifiant d'option, ou libellé exact (connecteur MCP, import).
      const opt = field.options.find((o) => o.id === value) ?? field.options.find((o) => o.label.toLowerCase() === value.toLowerCase());
      if (!opt) return { error: `« ${value} » n'est pas une valeur de « ${field.label} » (${field.options.map((o) => o.label).join(", ") || "liste vide"}).` };
      values[id] = opt.id;
    } else {
      if (value.length > MAX_CUSTOM_TEXT) return { error: `« ${field.label} » : ${MAX_CUSTOM_TEXT} caractères au plus.` };
      values[id] = value;
    }
  }
  return { values };
}
