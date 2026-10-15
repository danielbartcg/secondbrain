import { NextResponse, type NextRequest } from "next/server";
import { ApiError, withPublic } from "@/lib/api";
import { authenticateApiKeyScope } from "@/lib/api-keys";
import { rateLimit } from "@/lib/rate-limit";
import { handleRpc } from "@/lib/mcp";

/**
 * POST /api/v1/mcp — serveur MCP (Streamable HTTP, sans état, réponses JSON).
 * Authentification : `Authorization: Bearer sb_…` (clé d'accès personnelle,
 * Préférences → Connecteur Claude). Lecture seule. Voir docs/04-api.md.
 */

const MAX_BODY = 1_000_000;

function unauthorized(message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="second-brain", error="invalid_token"' } },
  );
}

export const POST = withPublic(async (req: NextRequest) => {
  // Protection « DNS rebinding » (recommandation MCP) : un navigateur d'une autre origine est refusé.
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* origine invalide */
    }
    if (!host || originHost !== host) throw new ApiError(403, "FORBIDDEN_ORIGIN", "Origine non autorisée.");
  }

  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const keyAuth = await authenticateApiKeyScope(key);
  const user = keyAuth?.user;
  if (!keyAuth || !user) return unauthorized("Clé d'accès manquante ou invalide (Préférences → Connecteur Claude).");
  if (!rateLimit(`mcp:${user.id}`, 600, 15 * 60 * 1000)) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Trop de requêtes, réessayez dans quelques minutes." } }, { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Requête trop volumineuse." } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide." } }, { status: 400 });
  }

  const batch = Array.isArray(body);
  const messages = (batch ? (body as unknown[]) : [body]).slice(0, 50) as Parameters<typeof handleRpc>[1][];
  const responses = [];
  for (const m of messages) {
    const r = await handleRpc(user, m, keyAuth.canWrite);
    if (r) responses.push(r);
  }
  // Uniquement des notifications / réponses : 202 sans contenu (spécification Streamable HTTP).
  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0], { headers: { "Cache-Control": "no-store" } });
});

/** Pas de flux SSE serveur → client : 405 (le client se contente de POST). */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
