import { z } from "zod";

/**
 * Schémas de validation des plannings de référence, de la fraîcheur, des
 * liens entre objets, de la résurgence et du flux iCal (docs/04-api.md).
 */

export const baselineNameSchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(120) });

/** Référence d'un objet de Prise de notes : « kind:id ». */
export const noteRefSchema = z.string().regex(/^(project|stage|activity|task|mindmap|node):[A-Za-z0-9_-]{1,64}$/, "Référence invalide");

export const resurfaceReviewSchema = z.object({
  ref: noteRefSchema,
  /** remember : toujours utile (boîte suivante) · again : à revoir bientôt (boîte 1) · archive : ne plus proposer. */
  answer: z.enum(["remember", "again", "archive"]),
});

export const staleDaysSchema = z.coerce.number().int().min(1).max(365);

/** Fin d'une journée de Paris (AAAA-MM-JJ) : 23:59:59 heure française, en UTC. */
function parisEndOfDay(ymd: string): Date {
  const utc = new Date(`${ymd}T23:59:59.999Z`);
  const parisHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(utc));
  // 23 h UTC = 0 h (hiver) ou 1 h (été) à Paris : décalage d'une ou deux heures.
  return new Date(utc.getTime() - ((parisHour + 24 - 23) % 24) * 3_600_000);
}

/** Date du voyage dans le temps (ISO ou AAAA-MM-JJ, interprétée en fin de journée, heure de Paris). */
export const timeTravelAtSchema = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? parisEndOfDay(v) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide" });
      return z.NEVER;
    }
    return d;
  });
