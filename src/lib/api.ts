import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { getCurrentUser, isCookieAuthenticated } from "@/lib/auth";
import type { User } from "@prisma/client";

/**
 * Socle des route handlers /api/v1 : réponses JSON homogènes, erreurs typées,
 * authentification et protection CSRF des requêtes authentifiées par cookie.
 *
 * Format d'erreur : { error: { code, message, details? } } (docs/04-api.md).
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Ressource") => new ApiError(404, "NOT_FOUND", `${what} introuvable.`);
export const forbidden = () => new ApiError(403, "FORBIDDEN", "Accès refusé.");
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Données invalides.", details: error.flatten() } },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Connexion requise." } },
      { status: 401 },
    );
  }
  console.error("[api]", error);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Erreur interne." } }, { status: 500 });
}

/**
 * Anti-CSRF : une requête mutante authentifiée par cookie doit venir de notre
 * propre origine. Les clients mobiles (Bearer) n'envoient pas de cookie et ne
 * sont pas concernés.
 */
async function assertSameOrigin(req: NextRequest): Promise<void> {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (!(await isCookieAuthenticated())) return;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Sans Origin : les navigateurs récents envoient Sec-Fetch-Site.
    if (req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "CSRF", "Origine non autorisée.");
    return;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "CSRF", "Origine invalide.");
  }
  if (!host || originHost !== host) throw new ApiError(403, "CSRF", "Origine non autorisée.");
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: { params: P; user: User }) => Promise<NextResponse>;
type PublicHandler<P> = (req: NextRequest, ctx: { params: P }) => Promise<NextResponse>;

/** Route authentifiée : 401 sinon. */
export function withUser<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<NextResponse> => {
    try {
      await assertSameOrigin(req);
      const user = await getCurrentUser();
      if (!user) throw new Error("UNAUTHENTICATED");
      const params = await ctx.params;
      return await handler(req, { params, user });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Route publique (connexion, inscription…). */
export function withPublic<P = Record<string, never>>(handler: PublicHandler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<NextResponse> => {
    try {
      await assertSameOrigin(req);
      const params = await ctx.params;
      return await handler(req, { params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Lit et valide le corps JSON. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  // Anti-CSRF (complément d'Origin) : un formulaire HTML d'un autre site ne peut
  // pas envoyer `application/json` sans requête préliminaire CORS.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json") && (await isCookieAuthenticated())) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Corps JSON attendu (Content-Type: application/json).");
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Corps JSON attendu.");
  }
  return schema.parse(raw);
}

/**
 * Adresse du client pour le rate limiting. L'application n'est joignable que
 * via Caddy (port publié sur 127.0.0.1) : Caddy pose X-Forwarded-For avec
 * l'adresse du pair TCP, ajoutée **à droite**. Seule la valeur la plus à
 * droite est fiable (celles de gauche peuvent être forgées par le client).
 */
export function clientKey(req: NextRequest): string {
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.[hops.length - 1] || req.headers.get("x-real-ip")?.trim() || "local";
}
