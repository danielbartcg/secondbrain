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

/** Options de mise en forme (notifications : type, citation ; comptes : libellé du bouton). */
export type MailOptions = {
  /** Libellé du bouton (défaut : déduit du lien). */
  cta?: string;
  /** Pastille au-dessus du titre (ex. « 💬 Mention »). */
  badge?: string;
  /** Le texte est un extrait cité (commentaire, message) : affiché en citation. */
  quote?: boolean;
  /** Ligne d'aperçu dans la boîte de réception (défaut : début du texte). */
  preheader?: string;
};

const BRAND = "#4f5ff0";
const INK = "#1f2330";
const MUTED = "#6b6f7b";
const LINE = "#e6e3dc";

/** Libellé du bouton d'après la destination. */
function ctaFor(href: string): string {
  if (href.startsWith("/tasks/")) return "Voir la tâche";
  if (href.startsWith("/messages")) return "Lire le message";
  if (href.includes("meeting=") || href.includes("#reunions")) return "Voir le compte-rendu";
  if (href.startsWith("/mindmaps/")) return "Ouvrir la carte";
  if (href.startsWith("/projects/")) return "Ouvrir le projet";
  return "Ouvrir Second Brain";
}

/** Paragraphes HTML (texte échappé, retours à la ligne conservés). */
function paragraphs(text: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Mise en forme commune des e-mails (HTML soigné + version texte) : bandeau
 * de marque, pastille facultative, titre, texte ou citation, bouton, pied de
 * page avec rappel des préférences. Mise en page en tableaux et styles en
 * ligne (Outlook, Gmail, Apple Mail) ; tout texte variable est échappé.
 */
export function renderMail(to: string, title: string, body: string, href: string, footer: string, opts: MailOptions = {}): MailContent {
  const site = SITE_URL();
  const url = site + (href.startsWith("/") ? href : "/");
  const subject = title.replace(/[\r\n]+/g, " ").slice(0, 200);
  const cta = opts.cta ?? ctaFor(href);
  const preheader = (opts.preheader ?? body ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  const text = `${title}\n\n${body ? (opts.quote ? body.split("\n").map((l) => "> " + l).join("\n") : body) + "\n\n" : ""}${cta} : ${url}\n\n— Second Brain\n${footer}\nPréférences de notification : ${site}/preferences`;
  const bodyHtml = !body
    ? ""
    : opts.quote
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="border-left:4px solid ${BRAND};background:#f3f4fe;border-radius:0 8px 8px 0;padding:14px 16px">${paragraphs(body, `margin:0 0 8px;font-size:15px;line-height:1.55;color:${INK};font-style:italic`)}</td></tr></table>`
      : paragraphs(body, `margin:0 0 16px;font-size:15px;line-height:1.6;color:#3b3f4a`);
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <tr><td style="padding:0 4px 14px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:34px;height:34px;background:${BRAND};border-radius:10px;text-align:center;font-size:18px;line-height:34px">🧠</td>
        <td style="padding-left:10px;font-size:16px;font-weight:700;color:${INK}">Second Brain</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="height:6px;background:${BRAND};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px">
          ${opts.badge ? `<div style="display:inline-block;background:#eef0fe;color:${BRAND};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin:0 0 14px">${escapeHtml(opts.badge)}</div>` : ""}
          <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${INK};font-weight:700">${escapeHtml(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:4px 32px 32px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${BRAND}">
            <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(url)}" style="height:44px;v-text-anchor:middle;width:240px" arcsize="22%" fillcolor="${BRAND}" stroke="f"><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold">${escapeHtml(cta)}</center></v:roundrect><![endif]-->
            <!--[if !mso]><!--><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(cta)} →</a><!--<![endif]-->
          </td></tr></table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${MUTED}">Le bouton ne fonctionne pas ? Copiez ce lien : <a href="${escapeHtml(url)}" style="color:${BRAND};word-break:break-all">${escapeHtml(url)}</a></p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:${MUTED}">
      ${escapeHtml(footer)}<br>
      <a href="${escapeHtml(site)}/preferences" style="color:${MUTED};text-decoration:underline">Gérer mes notifications par e-mail</a> · Second Brain
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { to, subject, text, html };
}

/** Pastille d'une notification : pictogramme + type. */
const NOTIF_ICON: Record<string, string> = {
  ASSIGNED: "📌",
  TASK_UPDATED: "✏️",
  REPLY: "↩️",
  MENTION: "💬",
  MESSAGE: "✉️",
  MEETING_REVIEW: "📝",
  MEETING_DECISION: "✅",
  MAP_SHARED: "🧠",
};
/** Types dont le texte est un extrait cité (commentaire, message). */
const QUOTED = new Set(["REPLY", "MENTION", "MESSAGE"]);

/** E-mail d'une notification. */
export function renderNotificationMail(to: string, n: { type: keyof typeof NOTIFICATION_TYPE_INFO; title: string; body: string; href: string; actorName: string | null }): MailContent {
  const info = NOTIFICATION_TYPE_INFO[n.type];
  const quote = QUOTED.has(n.type) || (n.type === "TASK_UPDATED" && /^« /.test(n.body));
  const footer = `Vous recevez cet e-mail pour la notification « ${info.label} »${n.actorName ? `, déclenchée par ${n.actorName}` : ""}.`;
  return renderMail(to, n.title, n.body, n.href, footer, { badge: `${NOTIF_ICON[n.type] ?? "🔔"} ${info.label}`, quote });
}

export async function sendMail(settings: AppSettings, mail: MailContent): Promise<void> {
  await transport(settings).sendMail({ from: settings.smtpFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** E-mail de test (Administration → Notifications) avec les paramètres enregistrés. */
export async function sendTestMail(to: string): Promise<void> {
  const s = await getAppSettings();
  if (!s.smtpHost || !s.smtpFrom) throw new Error("Serveur SMTP ou adresse d'expédition manquants.");
  await sendMail(
    s,
    renderMail(to, "E-mail de test", "Les paramètres SMTP de Second Brain fonctionnent : les notifications par e-mail peuvent partir.", "/admin/notifications", "Envoyé depuis Administration → Notifications.", { badge: "⚙️ Test SMTP", cta: "Retour à l'administration" }),
  );
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
      try {
        const mail = renderNotificationMail(n.user.email, n);
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
