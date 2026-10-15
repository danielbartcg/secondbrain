import "server-only";
import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { notificationPolicy } from "@/lib/settings";

/**
 * Notifications in-app (cloche). Chaque notification est destinée à un
 * utilisateur, porte un lien (`href`) vers l'endroit concerné et se marque
 * lue / non lue. Événements émis :
 *   - ASSIGNED     : une tâche vous a été assignée ;
 *   - REPLY        : quelqu'un a répondu à votre commentaire ;
 *   - TASK_UPDATED : une tâche qui vous est assignée a été modifiée
 *                    (regroupée : une seule notification non lue par tâche) ;
 *   - MENTION      : vous avez été mentionné dans un commentaire ;
 *   - MESSAGE      : nouveau message dans une conversation (regroupée :
 *                    une seule notification non lue par conversation).
 * L'auteur de l'action n'est jamais notifié de sa propre action.
 *
 * Administration → Notifications : un type désactivé n'est plus créé ; si les
 * e-mails sont activés, la notification est marquée `emailState = PENDING` et
 * l'envoyeur de src/lib/mailer.ts en expédie une copie après la transaction.
 */

export type NotificationDto = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  taskId: string | null;
  projectId: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
};

export type NotifyInput = {
  userId: string | null | undefined;
  type: NotificationType;
  title: string;
  body?: string;
  href: string;
  taskId?: string | null;
  projectId?: string | null;
  /** Auteur de l'action : jamais notifié lui-même. */
  actorId: string;
  actorName?: string | null;
};

type Db = Prisma.TransactionClient | typeof prisma;

function toDto(n: {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  taskId: string | null;
  projectId: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    taskId: n.taskId,
    projectId: n.projectId,
    actorName: n.actorName,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Crée les notifications (dédoublonnées par destinataire ; l'acteur est exclu). */
export async function notify(db: Db, items: NotifyInput[]): Promise<void> {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.userId || item.userId === item.actorId) continue;
    const key = `${item.userId}:${item.type}:${item.taskId ?? item.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const policy = await notificationPolicy(item.type);
    if (!policy.enabled) continue;
    const data = {
      userId: item.userId,
      type: item.type,
      title: item.title,
      body: item.body ?? "",
      href: item.href,
      taskId: item.taskId ?? null,
      projectId: item.projectId ?? null,
      actorName: item.actorName ?? null,
    };
    const groupWhere =
      item.type === "TASK_UPDATED" && item.taskId
        ? { taskId: item.taskId }
        : item.type === "MESSAGE" || item.type === "MEETING_REVIEW"
          ? { href: item.href }
          : null;
    if (groupWhere) {
      // Regroupement : un nouvel événement rafraîchit la notification non lue existante
      // (sans nouvel e-mail : le destinataire n'a pas encore lu le précédent).
      const existing = await db.notification.findFirst({
        where: { userId: item.userId, type: item.type, readAt: null, ...groupWhere },
        select: { id: true },
      });
      if (existing) {
        await db.notification.update({ where: { id: existing.id }, data: { ...data, createdAt: new Date() } });
        continue;
      }
    }
    // Copie e-mail : réglage global (Administration) et préférence du destinataire.
    const wantsEmail = policy.email && (await db.user.findUnique({ where: { id: item.userId }, select: { emailNotifications: true } }))?.emailNotifications === true;
    await db.notification.create({ data: { ...data, emailState: wantsEmail ? "PENDING" : null } });
  }
}

export async function listNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<{ notifications: NotificationDto[]; unreadCount: number }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: rows.map(toDto), unreadCount };
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function setNotificationRead(userId: string, id: string, read: boolean): Promise<NotificationDto> {
  const n = await prisma.notification.findFirst({ where: { id, userId } });
  if (!n) throw notFound("Notification");
  const row = await prisma.notification.update({ where: { id }, data: { readAt: read ? (n.readAt ?? new Date()) : null } });
  return toDto(row);
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export async function deleteNotification(userId: string, id: string): Promise<void> {
  const n = await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } });
  if (!n) throw notFound("Notification");
  await prisma.notification.delete({ where: { id } });
}
