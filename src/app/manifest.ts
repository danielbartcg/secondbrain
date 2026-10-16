import type { MetadataRoute } from "next";

/**
 * Manifeste de la PWA (iPhone « Sur l'écran d'accueil », Android « Installer
 * l'application ») : ouverture en plein écran sur le tableau de bord. Pas de
 * service worker : le site reste strictement en ligne (le hors-ligne est le
 * rôle des applications desktop et iPhone).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Second Brain",
    short_name: "Second Brain",
    description: "Cartes mentales et gestion de projets : votre second cerveau.",
    lang: "fr",
    start_url: "/dashboard",
    scope: "/",
    id: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f5f2",
    theme_color: "#4050e0",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mes tâches", url: "/organize", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Cartes mentales", url: "/mindmaps", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Projets", url: "/projects", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
