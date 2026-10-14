import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Application iPhone (phase 4) : même interface que l'application desktop
 * (build Vite de native/ dans native/electron/renderer), projet Xcode dans
 * native/ios. Voir docs/05-offline-sync.md, section « iPhone ».
 */
const config: CapacitorConfig = {
  appId: "fr.danielbartcg.secondbrain",
  appName: "Second Brain",
  webDir: "native/electron/renderer",
  ios: {
    path: "native/ios",
    // Fond des zones hors « safe area » (encoche, barre d'accueil).
    backgroundColor: "#f6f5f2",
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // fetch / XMLHttpRequest passent par la pile réseau native : pas de CORS
    // vers le serveur (le site n'envoie aucun en-tête CORS).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
