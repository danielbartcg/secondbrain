import type { Metadata, Viewport } from "next";
import { cache } from "react";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Second Brain", template: "%s · Second Brain" },
  description: "Cartes mentales et gestion de projets : votre second cerveau.",
  applicationName: "Second Brain",
};

/** Couleur de fond (--color-canvas) de chaque thème, pour la barre du navigateur mobile. */
const THEME_CANVAS: Record<string, string> = {
  light: "#f6f5f2",
  dark: "#111318",
  sepia: "#f4ecd8",
  ocean: "#eef4f8",
  forest: "#f1f4ee",
};

/** Thème préféré de l'utilisateur connecté (Préférences) ; clair par défaut. Une seule lecture par requête. */
const currentTheme = cache(async (): Promise<string> => {
  const user = await getCurrentUser().catch(() => null);
  return user && user.theme in THEME_CANVAS ? user.theme : "light";
});

export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_CANVAS[theme],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await currentTheme();
  return (
    <html lang="fr" className="h-full" data-theme={theme}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
