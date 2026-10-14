import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Second Brain", template: "%s · Second Brain" },
  description: "Cartes mentales et gestion de projets : votre second cerveau.",
  applicationName: "Second Brain",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f5f2",
};

const THEMES = ["light", "dark", "sepia", "ocean", "forest"];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Thème préféré de l'utilisateur connecté (Préférences) ; clair par défaut.
  const user = await getCurrentUser().catch(() => null);
  const theme = user && THEMES.includes(user.theme) ? user.theme : "light";
  return (
    <html lang="fr" className="h-full" data-theme={theme}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
