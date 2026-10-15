import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Build de l'application native (desktop Electron, puis iPhone Capacitor) :
 * les composants React du site (src/components) empaquetés en application
 * monopage, sans serveur Next. `next/link` et `next/navigation` sont remplacés
 * par un petit routeur (native/src/shims) ; l'API /api/v1 est servie par l'API
 * locale hors ligne (native/src/local).
 *
 * En développement (`npm run native:dev`), /__remote/* et /media/* sont
 * relayés vers le serveur (SB_SERVER, défaut http://localhost:3000).
 */
/**
 * Content-Security-Policy de l'application empaquetée (app://local dans
 * Electron, capacitor://localhost sur iPhone : tous deux « 'self' »).
 * Injectée au build seulement : le serveur de développement (HMR) a besoin de
 * scripts en ligne et d'une WebSocket.
 */
const NATIVE_CSP = [
  "default-src 'self'",
  "img-src 'self' https: http://localhost:* data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self' https: http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "secondbrain-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: NATIVE_CSP }, injectTo: "head-prepend" }],
  };
}

const root = path.resolve(__dirname, "..");
const server = process.env.SB_SERVER ?? "http://localhost:3000";

export default defineConfig({
  root: __dirname,
  // Chemins absolus : l'interface est servie à la racine (app://local/ dans Electron), même sur une URL profonde.
  base: "/",
  plugins: [react(), tailwindcss(), cspPlugin()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: path.resolve(__dirname, "src/shims/next-link.tsx") },
      { find: /^next\/navigation$/, replacement: path.resolve(__dirname, "src/shims/next-navigation.ts") },
      { find: /^server-only$/, replacement: path.resolve(__dirname, "src/shims/server-only.ts") },
      { find: /^@\//, replacement: path.resolve(root, "src") + "/" },
    ],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
  build: {
    // Directement dans le dossier applicatif Electron (native/electron), empaqueté par electron-builder.
    outDir: path.resolve(__dirname, "electron/renderer"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    proxy: {
      // Pas d'en-tête Origin : comme dans la coque native (requêtes du processus principal, jeton Bearer).
      "/__remote": {
        target: server,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__remote/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => req.removeHeader("origin"));
        },
      },
      "/media": { target: server, changeOrigin: true },
    },
  },
});
