import "server-only";
import type { JournalBlock, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";
import { htmlToText, sanitizeNotes } from "@/lib/sanitize";
import { hasHtmlContent } from "@/lib/shared/project-model";
import { addDays, parisMidnight, parisYmd } from "@/lib/shared/activity-period";
import {
  isValidDay,
  normalizeJournalBlocks,
  wordCount,
  type JournalActivityItem,
  type JournalBlockKey,
  type JournalDayDto,
  type JournalEntryDto,
  type JournalReportDto,
  type JournalWrittenBlock,
} from "@/lib/shared/journal";

/**
 * Journal quotidien (menu « Journal quotidien ») : blocs rédigés par jour
 * (texte riche assaini) et bloc « Activité » calculé depuis les pistes
 * d'audit des tâches et des cartes (actions de l'utilisateur ce jour-là, jour
 * de Paris). Strictement personnel : toutes les lectures et écritures sont
 * filtrées sur `userId`, sans exception pour les administrateurs.
 */

/** Plus longue période d'un rapport (jours). */
export const MAX_JOURNAL_REPORT_DAYS = 366;
const MAX_ACTIVITY_EVENTS = 5000;

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function checkDay(day: string) {
  if (!isValidDay(day)) throw badRequest("Jour invalide (AAAA-MM-JJ attendu).");
}

function toDto(e: { day: Date; block: JournalBlock; content: string; createdAt: Date; updatedAt: Date }): JournalEntryDto {
  return { day: dayOf(e.day), block: e.block, content: sanitizeNotes(e.content), createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() };
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Texte brut → paragraphes HTML. */
export function journalTextToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Activité de l'utilisateur (pistes d'audit) entre deux jours inclus, plus récente d'abord. */
async function activityBetween(userId: string, from: string, to: string): Promise<JournalActivityItem[]> {
  const range = { gte: parisMidnight(from), lt: parisMidnight(addDays(to, 1)) };
  const [tasks, maps] = await Promise.all([
    prisma.taskEvent.findMany({
      where: { actorId: userId, createdAt: range },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVITY_EVENTS,
      select: { createdAt: true, message: true, taskId: true, task: { select: { name: true, project: { select: { name: true } } } } },
    }),
    prisma.mapEvent.findMany({
      where: { actorId: userId, createdAt: range },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVITY_EVENTS,
      select: { createdAt: true, message: true, mapId: true, map: { select: { title: true } } },
    }),
  ]);
  return [
    ...tasks.map((e): JournalActivityItem => ({ at: e.createdAt.toISOString(), kind: "task", objectId: e.taskId, objectName: e.task.name, context: e.task.project?.name ?? null, message: e.message })),
    ...maps.map((e): JournalActivityItem => ({ at: e.createdAt.toISOString(), kind: "map", objectId: e.mapId, objectName: e.map.title, context: "Carte mentale", message: e.message })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** Une journée : saisies, activité et blocs activés. */
export async function getJournalDay(user: Pick<User, "id" | "journalBlocks">, day: string): Promise<JournalDayDto> {
  checkDay(day);
  const blocks = normalizeJournalBlocks(user.journalBlocks);
  const [rows, activity] = await Promise.all([
    prisma.journalEntry.findMany({ where: { userId: user.id, day: dayDate(day) } }),
    blocks.includes("ACTIVITY") ? activityBetween(user.id, day, day) : Promise.resolve([]),
  ]);
  return { day, entries: rows.map(toDto), activity, blocks };
}

/**
 * Enregistre un bloc : `content` (HTML assaini) ou `text` (texte brut) ;
 * `mode: "append"` ajoute à la suite de la saisie existante. Un contenu vide
 * supprime la saisie. Jours futurs refusés (au-delà de demain, fuseaux).
 */
export async function saveJournalBlock(
  userId: string,
  day: string,
  block: JournalWrittenBlock,
  input: { content?: string; text?: string; mode?: "replace" | "append" },
): Promise<JournalEntryDto | null> {
  checkDay(day);
  if (day > addDays(parisYmd(), 1)) throw badRequest("Impossible d'écrire dans le journal d'un jour futur.");
  const incoming = sanitizeNotes(input.content !== undefined ? input.content : journalTextToHtml(input.text ?? ""));
  const where = { userId_day_block: { userId, day: dayDate(day), block } };
  return prisma.$transaction(async (tx) => {
    const current = await tx.journalEntry.findUnique({ where });
    const html = input.mode === "append" && current && hasHtmlContent(current.content) ? sanitizeNotes(current.content + incoming) : incoming;
    if (!hasHtmlContent(html)) {
      if (current) await tx.journalEntry.delete({ where });
      return null;
    }
    const row = await tx.journalEntry.upsert({ where, create: { userId, day: dayDate(day), block, content: html }, update: { content: html } });
    return toDto(row);
  });
}

/** Jours renseignés (au moins un bloc) entre deux dates incluses : pastilles du calendrier. */
export async function journalDaysWithEntries(userId: string, from: string, to: string): Promise<string[]> {
  checkDay(from);
  checkDay(to);
  const rows = await prisma.journalEntry.findMany({ where: { userId, day: { gte: dayDate(from), lte: dayDate(to) } }, select: { day: true }, distinct: ["day"], orderBy: { day: "asc" } });
  return rows.map((r) => dayOf(r.day));
}

function checkRange(from: string, to: string) {
  checkDay(from);
  checkDay(to);
  if (from > to) throw badRequest("La date de début doit précéder la date de fin.");
  const days = Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_JOURNAL_REPORT_DAYS) throw badRequest(`${MAX_JOURNAL_REPORT_DAYS} jours au plus.`);
}

/** Toutes les saisies (blocs rédigés) d'une période, plus récentes d'abord ; filtre facultatif sur les blocs. */
export async function listJournalEntries(userId: string, from: string, to: string, blocks?: JournalWrittenBlock[]): Promise<JournalEntryDto[]> {
  checkRange(from, to);
  const rows = await prisma.journalEntry.findMany({
    where: { userId, day: { gte: dayDate(from), lte: dayDate(to) }, ...(blocks?.length ? { block: { in: blocks } } : {}) },
    orderBy: [{ day: "desc" }, { block: "asc" }],
  });
  return rows.map(toDto);
}

/** Rapport d'un bloc entre deux dates : saisies (ou activité) et série quotidienne. */
export async function getJournalReport(userId: string, block: JournalBlockKey, from: string, to: string): Promise<JournalReportDto> {
  checkRange(from, to);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (block === "ACTIVITY") {
    const items = await activityBetween(userId, from, to);
    const byDay = new Map<string, JournalActivityItem[]>();
    for (const it of items) {
      const d = parisYmd(new Date(it.at));
      byDay.set(d, [...(byDay.get(d) ?? []), it]);
    }
    return {
      block,
      from,
      to,
      entries: [],
      activityDays: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => ({ day, count: list.length, items: list.slice(0, 200) })),
      series: days.map((day) => ({ day, value: byDay.get(day)?.length ?? 0 })),
    };
  }
  const entries = await listJournalEntries(userId, from, to, [block]);
  const words = new Map(entries.map((e) => [e.day, wordCount(htmlToText(e.content, 100_000))]));
  return { block, from, to, entries, activityDays: [], series: days.map((day) => ({ day, value: words.get(day) ?? 0 })) };
}


