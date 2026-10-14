import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/roles";

/**
 * Authentification e-mail / mot de passe, sessions opaques persistées en base.
 *
 *  - Web : jeton posé en cookie HTTP-only `session`.
 *  - Mobile : le même jeton est accepté en `Authorization: Bearer <token>`
 *    sur toute l'API /api/v1 (voir docs/04-api.md).
 */

export const SESSION_COOKIE = "session";
const SESSION_DURATION_DAYS = 90;

export type PublicUser = Pick<User, "id" | "email" | "name" | "firstName" | "lastName" | "avatarUrl" | "theme" | "role" | "createdAt"> & { isAdmin: boolean };

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    theme: user.theme,
    role: user.role,
    isAdmin: isAdmin(user),
    createdAt: user.createdAt,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Crée une session en base ; `setCookie` (défaut : vrai) pose aussi le cookie web. */
export async function createSession(
  userId: string,
  options: { label?: string; setCookie?: boolean } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt, label: options.label ?? null } });
  if (options.setCookie !== false) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
      path: "/",
    });
  }
  return { token, expiresAt };
}

export async function destroySession(): Promise<void> {
  const token = await getSessionToken();
  if (token) await prisma.session.deleteMany({ where: { token } });
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Jeton de session : header Authorization (mobile) prioritaire, sinon cookie (web). */
export async function getSessionToken(): Promise<string | null> {
  const headerStore = await headers();
  const auth = headerStore.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

/** Vrai si la requête courante est authentifiée par cookie (et non par Bearer). */
export async function isCookieAuthenticated(): Promise<boolean> {
  const headerStore = await headers();
  return !headerStore.get("authorization")?.startsWith("Bearer ");
}

export async function getCurrentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/** Lève UNAUTHENTICATED si personne n'est connecté. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export function registrationAllowed(): boolean {
  return (process.env.ALLOW_REGISTRATION ?? "true").toLowerCase() !== "false";
}
