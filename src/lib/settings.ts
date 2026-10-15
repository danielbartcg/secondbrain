import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { AppSettings, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";

/**
 * Paramètres globaux (Administration → Notifications) : serveur SMTP,
 * activation des e-mails, notifications activées pour tout le monde.
 *
 * Le mot de passe SMTP est chiffré en base (AES-256-GCM, clé dérivée de
 * SESSION_SECRET) et n'est jamais renvoyé au navigateur.
 */

export const NOTIFICATION_TYPES = ["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE", "MEETING_REVIEW", "MEETING_DECISION", "MAP_SHARED"] as const satisfies readonly NotificationType[];

export type NotificationSettingsDto = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  /** Un mot de passe est enregistré (sa valeur n'est jamais transmise). */
  smtpPasswordSet: boolean;
  smtpFrom: string;
  emailEnabled: boolean;
  /** Pour chaque type : activé (cloche + e-mail) et copie e-mail. */
  types: { type: NotificationType; enabled: boolean; email: boolean }[];
  /** Copies e-mail des 7 derniers jours. */
  stats: { sent: number; failed: number; pending: number; lastError: string | null };
};

export type NotificationSettingsInput = {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** undefined = inchangé ; "" = effacer. */
  smtpPassword?: string;
  smtpFrom?: string;
  emailEnabled?: boolean;
  types?: { type: NotificationType; enabled: boolean; email: boolean }[];
};

// --- Chiffrement du mot de passe SMTP --------------------------------------------------------

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET manquant ou trop court (chiffrement du mot de passe SMTP).");
  return Buffer.from(hkdfSync("sha256", secret, "secondbrain/app-settings", "smtp-password", 32));
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(enc: string): string {
  if (!enc) return "";
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !data) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // SESSION_SECRET changé : le mot de passe est à ressaisir.
    return "";
  }
}

// --- Lecture (avec cache court : notify() la consulte à chaque notification) ---------------

let cache: { at: number; value: AppSettings } | null = null;
const TTL = 30_000;

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const value = (await prisma.appSettings.findUnique({ where: { id: "global" } })) ?? (await prisma.appSettings.create({ data: { id: "global" } }));
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Faut-il créer cette notification, et l'envoyer par e-mail ? */
export async function notificationPolicy(type: NotificationType): Promise<{ enabled: boolean; email: boolean }> {
  const s = await getAppSettings();
  const enabled = !s.disabledTypes.includes(type);
  return { enabled, email: enabled && s.emailEnabled && !!s.smtpHost && !!s.smtpFrom && !s.emailDisabledTypes.includes(type) };
}

export async function getNotificationSettings(): Promise<NotificationSettingsDto> {
  invalidateSettingsCache();
  const s = await getAppSettings();
  const since = new Date(Date.now() - 7 * 86400_000);
  const [sent, failed, pending, last] = await Promise.all([
    prisma.notification.count({ where: { emailState: "SENT", createdAt: { gte: since } } }),
    prisma.notification.count({ where: { emailState: "FAILED", createdAt: { gte: since } } }),
    prisma.notification.count({ where: { emailState: { in: ["PENDING", "SENDING"] } } }),
    prisma.notification.findFirst({ where: { emailState: "FAILED", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { emailError: true } }),
  ]);
  return {
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort,
    smtpSecure: s.smtpSecure,
    smtpUser: s.smtpUser,
    smtpPasswordSet: !!s.smtpPasswordEnc,
    smtpFrom: s.smtpFrom,
    emailEnabled: s.emailEnabled,
    types: NOTIFICATION_TYPES.map((type) => ({ type, enabled: !s.disabledTypes.includes(type), email: !s.emailDisabledTypes.includes(type) })),
    stats: { sent, failed, pending, lastError: last?.emailError ?? null },
  };
}

export async function updateNotificationSettings(input: NotificationSettingsInput): Promise<NotificationSettingsDto> {
  const current = await getAppSettings();
  const data: Partial<AppSettings> = {};
  if (input.smtpHost !== undefined) data.smtpHost = input.smtpHost.trim();
  if (input.smtpPort !== undefined) data.smtpPort = input.smtpPort;
  if (input.smtpSecure !== undefined) data.smtpSecure = input.smtpSecure;
  if (input.smtpUser !== undefined) data.smtpUser = input.smtpUser.trim();
  if (input.smtpPassword !== undefined) data.smtpPasswordEnc = encryptSecret(input.smtpPassword);
  if (input.smtpFrom !== undefined) data.smtpFrom = input.smtpFrom.trim();
  if (input.emailEnabled !== undefined) data.emailEnabled = input.emailEnabled;
  if (input.types) {
    data.disabledTypes = input.types.filter((t) => !t.enabled).map((t) => t.type);
    data.emailDisabledTypes = input.types.filter((t) => !t.email).map((t) => t.type);
  }
  const next = { ...current, ...data };
  if (next.emailEnabled && (!next.smtpHost || !next.smtpFrom)) throw badRequest("Renseignez au moins le serveur SMTP et l'adresse d'expédition avant d'activer les e-mails.");
  await prisma.appSettings.update({ where: { id: "global" }, data });
  invalidateSettingsCache();
  return getNotificationSettings();
}

// --- Inscriptions libres ---------------------------------------------------------------------------

/** La variable d'environnement ALLOW_REGISTRATION=false ferme les inscriptions quoi qu'il arrive. */
function registrationForcedClosed(): boolean {
  return (process.env.ALLOW_REGISTRATION ?? "true").toLowerCase() === "false";
}

export type RegistrationSettingsDto = { enabled: boolean; forcedClosed: boolean; open: boolean };

export async function getRegistrationSettings(): Promise<RegistrationSettingsDto> {
  const s = await getAppSettings();
  const forcedClosed = registrationForcedClosed();
  return { enabled: s.registrationEnabled, forcedClosed, open: s.registrationEnabled && !forcedClosed };
}

/** Inscriptions ouvertes (réglage d'administration ET variable d'environnement). */
export async function registrationOpen(): Promise<boolean> {
  return (await getRegistrationSettings()).open;
}

export async function setRegistrationEnabled(enabled: boolean): Promise<RegistrationSettingsDto> {
  await getAppSettings();
  await prisma.appSettings.update({ where: { id: "global" }, data: { registrationEnabled: enabled } });
  invalidateSettingsCache();
  return getRegistrationSettings();
}
