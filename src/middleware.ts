import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy des pages, avec nonce par requête (docs Next 15 :
 * « Content Security Policy » → nonces). Next lit le nonce dans l'en-tête CSP
 * de la requête et l'applique à ses propres scripts ; `'strict-dynamic'`
 * autorise les chunks chargés ensuite par ces scripts. Toutes les pages sont
 * rendues dynamiquement (le layout racine lit la session), condition requise.
 *
 * Les routes /api, les fichiers statiques, /media et /downloads gardent les
 * en-têtes statiques de next.config.ts.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' : uniquement en développement (React Refresh / webpack).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon\.ico|media/|downloads/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
