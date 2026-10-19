import { z } from "zod";
import { JOURNAL_BLOCKS, JOURNAL_WRITTEN_BLOCKS } from "@/lib/shared/journal";

/** Schémas de validation du journal quotidien (docs/04-api.md). */

export const journalDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Jour invalide (AAAA-MM-JJ attendu)");
export const journalBlockSchema = z.enum(JOURNAL_BLOCKS);
export const journalWrittenBlockSchema = z.enum(JOURNAL_WRITTEN_BLOCKS, { errorMap: () => ({ message: "Bloc inconnu ou non modifiable (l'activité est calculée)." }) });

export const journalSaveSchema = z
  .object({
    /** HTML (assaini par le serveur). */
    content: z.string().max(500_000).optional(),
    /** Texte brut (converti en paragraphes) — connecteur MCP. */
    text: z.string().max(100_000).optional(),
    /** replace (défaut) : remplace la saisie ; append : ajoute à la suite. */
    mode: z.enum(["replace", "append"]).optional(),
  })
  .refine((v) => v.content !== undefined || v.text !== undefined, { message: "content ou text requis" });

export const journalBlocksPrefSchema = z.array(journalBlockSchema).max(JOURNAL_BLOCKS.length);
