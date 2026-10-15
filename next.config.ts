import type { NextConfig } from "next";

/**
 * En-têtes de sécurité. La CSP des **pages** (avec nonce) est posée par
 * src/middleware.ts ; ici, une CSP stricte pour l'API (JSON) et les fichiers
 * servis (/media, /downloads). Les téléchargements de documents
 * (/api/v1/documents/…/download) posent leur propre CSP (route handler).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // Chargé tel quel par Node (pas empaqueté) : modules node:* (envoi d'e-mails).
  serverExternalPackages: ["nodemailer", "exceljs"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/api/:path((?!v1/documents/).*)",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }],
      },
      {
        source: "/(media|downloads)/:path*",
        headers: [{ key: "Content-Security-Policy", value: "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
