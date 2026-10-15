import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { AppSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, getAppSettings } from "@/lib/settings";
import { NOTIFICATION_TYPE_INFO } from "@/lib/shared/notification-types";

/**
 * Copies e-mail des notifications.
 *
 * notify() marque la notification `emailState = PENDING` (dans la transaction
 * métier) ; un envoyeur en tâche de fond (démarré par src/instrumentation.ts)
 * relève les notifications en attente toutes les 10 s, après validation de la
 * transaction : jamais d'appel réseau SMTP dans une transaction.
 */

const SITE_URL = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function transport(s: Pick<AppSettings, "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPasswordEnc">): Transporter {
  const pass = decryptSecret(s.smtpPasswordEnc);
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: s.smtpUser ? { user: s.smtpUser, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export type MailContent = { to: string; subject: string; text: string; html: string };

/** Mise en forme commune : titre, texte, bouton vers la plateforme. */
export function renderMail(to: string, title: string, body: string, href: string, footer: string): MailContent {
  const url = SITE_URL() + (href.startsWith("/") ? href : "/");
  const subject = title.replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = `${title}\n\n${body ? body + "\n\n" : ""}Ouvrir : ${url}\n\n— Second Brain\n${footer}`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2330">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e6e3dc">
<div style="font-size:13px;color:#6b6f7b;margin-bottom:8px">🧠 Second Brain</div>
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>
${body ? `<p style="font-size:14px;line-height:1.5;white-space:pre-line;margin:0 0 20px">${escapeHtml(body)}</p>` : ""}
<a href="${escapeHtml(url)}" style="display:inline-block;background:#3f4ee0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Ouvrir dans Second Brain</a>
<p style="font-size:12px;color:#8a8e99;margin:24px 0 0">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export async function sendMail(settings: AppSettings, mail: MailContent): Promise<void> {
  await transport(settings).sendMail({ from: settings.smtpFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** E-mail de test (Administration → Notifications) avec les paramètres enregistrés. */
export async function sendTestMail(to: string): Promise<void> {
  const s = await getAppSettings();
  if (!s.smtpHost || !s.smtpFrom) throw new Error("Serveur SMTP ou adresse d'expédition manquants.");
  await sendMail(s, renderMail(to, "E-mail de test", "Les paramètres SMTP de Second Brain fonctionnent.", "/admin/notifications", "Envoyé depuis Administration → Notifications."));
}

// --- Envoyeur en tâche de fond ----------------------------------------------------------------

const BATCH = 20;
/** Une copie e-mail qui attend plus longtemps n'a plus d'intérêt : abandonnée. */
const MAX_AGE_MS = 24 * 3600_000;

export async function processEmailQueue(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  // Reprise après arrêt brutal : une notification restée « SENDING » repasse en attente.
  await prisma.notification.updateMany({ where: { emailState: "SENDING", createdAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { emailState: "PENDING" } });
  await prisma.notification.updateMany({ where: { emailState: "PENDING", createdAt: { lt: new Date(Date.now() - MAX_AGE_MS) } }, data: { emailState: "FAILED", emailError: "Abandonné (plus de 24 h d'attente)." } });

  const s = await getAppSettings();
  if (!s.emailEnabled || !s.smtpHost || !s.smtpFrom) return { sent, failed };
  const pending = await prisma.notification.findMany({
    where: { emailState: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: { user: { select: { email: true } } },
  });
  if (pending.length === 0) return { sent, failed };
  const t = transport(s);
  try {
    for (const n of pending) {
      const claimed = await prisma.notification.updateMany({ where: { id: n.id, emailState: "PENDING" }, data: { emailState: "SENDING" } });
      if (claimed.count === 0) continue;
      const footer = `Notification « ${NOTIFICATION_TYPE_INFO[n.type].label} »${n.actorName ? ` — par ${n.actorName}` : ""}.`;
      try {
        const mail = renderMail(n.user.email, n.title, n.body, n.href, footer);
        await t.sendMail({ from: s.smtpFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
        await prisma.notification.update({ where: { id: n.id }, data: { emailState: "SENT", emailError: null } });
        sent++;
      } catch (e) {
        await prisma.notification.update({ where: { id: n.id }, data: { emailState: "FAILED", emailError: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
        failed++;
      }
    }
  } finally {
    t.close();
  }
  return { sent, failed };
}

const g = globalThis as unknown as { __sbEmailWorker?: NodeJS.Timeout };

export function startEmailWorker(intervalMs = 10_000) {
  if (g.__sbEmailWorker) return;
  let running = false;
  g.__sbEmailWorker = setInterval(() => {
    if (running) return;
    running = true;
    processEmailQueue()
      .catch((e) => console.error("[email]", e instanceof Error ? e.message : e))
      .finally(() => (running = false));
  }, intervalMs);
  g.__sbEmailWorker.unref?.();
}
