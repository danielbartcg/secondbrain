import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { EmailTokenKind, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { renderMail, sendMail } from "@/lib/mailer";
import { isSuperAdmin } from "@/lib/roles";

/**
 * E-mails de compte (hors notifications) :
 *  - bienvenue + lien de validation de l'adresse à l'inscription ;
 *  - validation après changement d'adresse (Préférences) ;
 *  - mot de passe oublié.
 * Uniquement si l'envoi d'e-mails est configuré et activé (Administration →
 * Notifications). La validation est informative : elle n'empêche jamais la
 * connexion. Les liens sont à usage unique ; seule leur empreinte SHA-256
 * est stockée (EmailToken).
 */

const VERIFY_TTL_MS = 7 * 24 * 3600_000;
const RESET_TTL_MS = 60 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Envoi d'e-mails configuré et activé (serveur, expéditeur, interrupteur général). */
export async function mailConfigured(): Promise<boolean> {
  const s = await getAppSettings();
  return s.emailEnabled && !!s.smtpHost && !!s.smtpFrom;
}

async function issueToken(userId: string, kind: EmailTokenKind, email: string, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Un seul lien valide à la fois par usage : les précédents sont invalidés.
  await prisma.emailToken.deleteMany({ where: { userId, kind, usedAt: null } });
  await prisma.emailToken.create({ data: { userId, kind, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function consumeToken(kind: EmailTokenKind, token: string) {
  if (!token || token.length > 200) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null;
  // Consommation atomique : un lien ne sert qu'une fois, même cliqué deux fois en parallèle.
  const claimed = await prisma.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? row : null;
}

/** Envoi sans bloquer ni faire échouer la requête (journalisé en cas d'erreur). */
function sendInBackground(build: () => Promise<{ to: string; subject: string; text: string; html: string } | null>) {
  void (async () => {
    try {
      const mail = await build();
      if (!mail) return;
      await sendMail(await getAppSettings(), mail);
    } catch (e) {
      console.error("[email:compte]", e instanceof Error ? e.message : e);
    }
  })();
}

/** Inscription : e-mail de bienvenue avec lien de validation. */
export function sendWelcomeEmail(user: Pick<User, "id" | "email" | "name">) {
  sendInBackground(async () => {
    if (!(await mailConfigured())) return null;
    const token = await issueToken(user.id, "VERIFY_EMAIL", user.email, VERIFY_TTL_MS);
    return renderMail(
      user.email,
      `Bienvenue sur Second Brain, ${user.name} !`,
      "Merci pour votre inscription. Vos projets, cartes mentales et notes vous attendent.\n\nConfirmez votre adresse e-mail avec le bouton ci-dessous (lien valable 7 jours).",
      `/verify-email?token=${token}`,
      "Vous n'êtes pas à l'origine de cette inscription ? Ignorez simplement cet e-mail.",
    );
  });
}

/** Préférences : (r)envoi du lien de validation de l'adresse actuelle. */
export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name" | "emailVerifiedAt">): Promise<void> {
  if (user.emailVerifiedAt) throw new ApiError(409, "ALREADY_VERIFIED", "Votre adresse est déjà validée.");
  if (!(await mailConfigured())) throw new ApiError(503, "MAIL_DISABLED", "L'envoi d'e-mails n'est pas configuré sur la plateforme.");
  const token = await issueToken(user.id, "VERIFY_EMAIL", user.email, VERIFY_TTL_MS);
  await sendMail(
    await getAppSettings(),
    renderMail(user.email, "Confirmez votre adresse e-mail", "Cliquez sur le bouton ci-dessous pour confirmer votre adresse (lien valable 7 jours).", `/verify-email?token=${token}`, "Vous n'êtes pas à l'origine de cette demande ? Ignorez cet e-mail."),
  );
}

/** Lien de validation : l'adresse est validée si c'est toujours celle du compte. */
export async function verifyEmail(token: string): Promise<{ email: string }> {
  const row = await consumeToken("VERIFY_EMAIL", token);
  if (!row) throw new ApiError(400, "INVALID_TOKEN", "Lien invalide ou expiré.");
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
  if (!user || user.email !== row.email) throw new ApiError(400, "INVALID_TOKEN", "Ce lien concerne une ancienne adresse du compte.");
  await prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  return { email: row.email };
}

/**
 * Mot de passe oublié : réponse identique que le compte existe ou non (pas
 * d'énumération) ; l'e-mail part en arrière-plan.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!(await mailConfigured())) throw new ApiError(503, "MAIL_DISABLED", "La réinitialisation par e-mail n'est pas disponible.");
  sendInBackground(async () => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
    if (!user) return null;
    const token = await issueToken(user.id, "RESET_PASSWORD", user.email, RESET_TTL_MS);
    return renderMail(
      user.email,
      "Réinitialisation de votre mot de passe",
      `Bonjour ${user.name},\n\nUne réinitialisation du mot de passe a été demandée pour votre compte. Le lien ci-dessous est valable 1 heure et ne sert qu'une fois.`,
      `/reset-password?token=${token}`,
      "Vous n'êtes pas à l'origine de cette demande ? Ignorez cet e-mail : votre mot de passe reste inchangé.",
    );
  });
}

/** Nouveau mot de passe via le lien : toutes les sessions sont fermées ; l'adresse est de fait validée. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await consumeToken("RESET_PASSWORD", token);
  if (!row) throw new ApiError(400, "INVALID_TOKEN", "Lien invalide ou expiré. Refaites une demande.");
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
  if (!user) throw new ApiError(400, "INVALID_TOKEN", "Lien invalide ou expiré.");
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(newPassword), ...(user.email === row.email ? { emailVerifiedAt: new Date() } : {}) },
    }),
    prisma.session.deleteMany({ where: { userId: row.userId } }),
    prisma.emailToken.deleteMany({ where: { userId: row.userId, kind: "RESET_PASSWORD", usedAt: null } }),
  ]);
}

/**
 * Changement d'adresse (Préférences) : mot de passe actuel exigé ; la nouvelle
 * adresse est « non validée » et reçoit un lien si l'envoi est configuré.
 */
export async function changeEmail(user: User, newEmail: string, currentPassword: string): Promise<{ email: string; verificationSent: boolean }> {
  const email = newEmail.trim().toLowerCase();
  if (email === user.email) throw badRequest("C'est déjà votre adresse.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new ApiError(400, "BAD_PASSWORD", "Mot de passe actuel incorrect.");
  // Le rôle de super administrateur est attaché à une adresse : elle ne peut pas être prise.
  if (isSuperAdmin({ email }) || (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
    throw new ApiError(409, "EMAIL_TAKEN", "Cette adresse est déjà utilisée par un autre compte.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: null } });
  await prisma.emailToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  let verificationSent = false;
  if (await mailConfigured()) {
    try {
      await sendVerificationEmail({ id: user.id, email, name: user.name, emailVerifiedAt: null });
      verificationSent = true;
    } catch (e) {
      console.error("[email:compte]", e instanceof Error ? e.message : e);
    }
  }
  return { email, verificationSent };
}
