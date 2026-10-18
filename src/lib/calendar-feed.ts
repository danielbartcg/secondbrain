import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { tasksOfUsersWhere } from "@/lib/tasks";
import { buildCalendar, type CalendarEvent } from "@/lib/shared/ical";

/**
 * Flux iCal personnel (Préférences → Calendrier) : une URL secrète à laquelle
 * Outlook, Google Agenda ou l'iPhone s'abonnent (lecture seule). Contenu, du
 * point de vue de l'utilisateur : échéances de **mes** tâches ouvertes
 * (`tasksOfUsersWhere`, projets actifs / en pause et sans projet), mes
 * sessions de travail, les réunions où je suis rédacteur, participant ou
 * validateur, et les livrables dont je suis responsable — de 90 jours en
 * arrière à un an en avant, 2 000 évènements au plus.
 *
 * Le jeton (`cal_` + 256 bits) n'est montré qu'à sa création ; seule son
 * empreinte SHA-256 est stockée. Régénérer invalide l'ancienne adresse.
 */

export const CALENDAR_TOKEN_PREFIX = "cal_";
const MAX_EVENTS = 2000;
const DAY_MS = 86_400_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type CalendarFeedStatus = { active: boolean; createdAt: string | null; lastUsedAt: string | null };

export async function getCalendarFeed(userId: string): Promise<CalendarFeedStatus> {
  const f = await prisma.calendarFeed.findUnique({ where: { userId } });
  return { active: !!f, createdAt: f?.createdAt.toISOString() ?? null, lastUsedAt: f?.lastUsedAt?.toISOString() ?? null };
}

/** Crée (ou régénère) l'adresse du flux ; renvoie le chemin à n'afficher qu'une fois. */
export async function createCalendarFeed(userId: string): Promise<{ path: string; feed: CalendarFeedStatus }> {
  const token = CALENDAR_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const f = await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, tokenHash },
    update: { tokenHash, createdAt: new Date(), lastUsedAt: null },
  });
  return { path: `/api/v1/calendar/${token}.ics`, feed: { active: true, createdAt: f.createdAt.toISOString(), lastUsedAt: null } };
}

export async function deleteCalendarFeed(userId: string): Promise<void> {
  await prisma.calendarFeed.deleteMany({ where: { userId } });
}

/** Utilisateur d'un jeton de flux (null si inconnu ou révoqué). */
export async function feedOwner(token: string): Promise<{ userId: string; name: string } | null> {
  if (!token.startsWith(CALENDAR_TOKEN_PREFIX) || token.length > 100) return null;
  const f = await prisma.calendarFeed.findUnique({ where: { tokenHash: sha256(token) }, select: { userId: true, lastUsedAt: true, user: { select: { name: true } } } });
  if (!f) return null;
  // Dernière utilisation : au plus une écriture par heure (les agendas interrogent souvent).
  if (!f.lastUsedAt || Date.now() - f.lastUsedAt.getTime() > 3_600_000) {
    await prisma.calendarFeed.update({ where: { userId: f.userId }, data: { lastUsedAt: new Date() } });
  }
  return { userId: f.userId, name: f.user.name };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Évènements du flux d'un utilisateur. `origin` sert aux liens (https://hôte). */
export async function calendarEvents(userId: string, origin: string, now = new Date()): Promise<CalendarEvent[]> {
  const from = new Date(now.getTime() - 90 * DAY_MS);
  const to = new Date(now.getTime() + 366 * DAY_MS);
  const activeProject = { OR: [{ projectId: null }, { project: { status: { in: ["ACTIVE" as const, "ON_HOLD" as const] } } }] };

  const [tasks, sessions, meetings, deliverables] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [taskAccessWhere(userId), tasksOfUsersWhere([userId]), activeProject, { status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { gte: from, lte: to } }] },
      orderBy: { dueDate: "asc" },
      take: MAX_EVENTS,
      select: { id: true, name: true, description: true, dueDate: true, updatedAt: true, project: { select: { name: true } }, stage: { select: { name: true } } },
    }),
    prisma.workSession.findMany({
      where: { userId, date: { gte: from, lte: to }, task: { AND: [taskAccessWhere(userId), activeProject] } },
      orderBy: { date: "asc" },
      take: MAX_EVENTS,
      select: { id: true, date: true, createdAt: true, task: { select: { id: true, name: true, project: { select: { name: true } } } } },
    }),
    prisma.meeting.findMany({
      where: {
        date: { gte: from, lte: to },
        project: projectAccessWhere(userId),
        OR: [{ authorId: userId }, { participants: { some: { member: { userId } } } }, { approvers: { some: { member: { userId } } } }],
      },
      orderBy: { date: "asc" },
      take: MAX_EVENTS,
      select: { id: true, title: true, date: true, location: true, updatedAt: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.deliverable.findMany({
      where: { expectedEnd: { gte: from, lte: to }, status: { in: ["PLANNED", "IN_PROGRESS"] }, assignee: { userId }, project: { ...projectAccessWhere(userId), status: { in: ["ACTIVE", "ON_HOLD"] } } },
      orderBy: { expectedEnd: "asc" },
      take: MAX_EVENTS,
      select: { id: true, name: true, expectedEnd: true, updatedAt: true, projectId: true, project: { select: { name: true } } },
    }),
  ]);

  const events: CalendarEvent[] = [
    ...tasks.map((t) => ({
      uid: `task-${t.id}@secondbrain`,
      allDay: ymd(t.dueDate!),
      summary: `Échéance : ${t.name}`,
      description: [[t.project?.name ?? "Sans projet", t.stage?.name].filter(Boolean).join(" › "), t.description].filter(Boolean).join("\n\n"),
      url: `${origin}/tasks/${t.id}`,
      updatedAt: t.updatedAt,
    })),
    ...sessions.map((s) => ({
      uid: `session-${s.id}@secondbrain`,
      allDay: ymd(s.date),
      summary: `Session : ${s.task.name}`,
      description: `Session de travail planifiée — ${s.task.project?.name ?? "Sans projet"}`,
      url: `${origin}/tasks/${s.task.id}`,
      updatedAt: s.createdAt,
      transparent: true,
    })),
    ...meetings.map((m) => ({
      uid: `meeting-${m.id}@secondbrain`,
      start: m.date,
      end: new Date(m.date.getTime() + 3_600_000),
      summary: `Réunion : ${m.title}`,
      description: `Projet ${m.project.name}`,
      location: m.location,
      url: `${origin}/projects/${m.projectId}?meeting=${m.id}#reunions`,
      updatedAt: m.updatedAt,
    })),
    ...deliverables.map((d) => ({
      uid: `deliverable-${d.id}@secondbrain`,
      allDay: ymd(d.expectedEnd!),
      summary: `Livrable : ${d.name}`,
      description: `Projet ${d.project.name}`,
      url: `${origin}/projects/${d.projectId}#livrables`,
      updatedAt: d.updatedAt,
    })),
  ];
  return events.slice(0, MAX_EVENTS);
}

export async function renderCalendar(userId: string, userName: string, origin: string): Promise<string> {
  return buildCalendar(`Second Brain — ${userName}`, await calendarEvents(userId, origin));
}
