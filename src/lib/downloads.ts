import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/uploads";

/**
 * Installateurs de l'application desktop, publiés par `npm run desktop:publish`
 * dans DATA_DIR/downloads (avec latest.json). Servis publiquement par
 * /downloads/<fichier> et présentés sur la page /app.
 */

export type DesktopRelease = { platform: "windows"; version: string; file: string; size: number; sha256: string; publishedAt: string };

export const INSTALLER_RE = /^SecondBrain-Setup-\d+\.\d+\.\d+\.exe$/;

export function downloadsDir(): string {
  return path.join(dataDir(), "downloads");
}

export function latestDesktop(): DesktopRelease | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(downloadsDir(), "latest.json"), "utf8")) as DesktopRelease;
    if (!INSTALLER_RE.test(meta.file) || !fs.existsSync(path.join(downloadsDir(), meta.file))) return null;
    return meta;
  } catch {
    return null;
  }
}

/** Chemin d'un installateur publié (nom vérifié), ou null. */
export function installerPath(file: string): string | null {
  if (!INSTALLER_RE.test(file)) return null;
  const p = path.join(downloadsDir(), file);
  return fs.existsSync(p) ? p : null;
}
