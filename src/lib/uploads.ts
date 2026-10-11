import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api";

/**
 * Stockage des images collées dans les notes.
 *
 *  - allowlist de types MIME, taille bornée, pas de SVG (vecteur XSS) ;
 *  - nom de fichier aléatoire, jamais dérivé du nom client ;
 *  - tout accès disque borné par DATA_DIR/uploads (anti-traversée).
 */

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

export async function saveImage(file: File): Promise<{ url: string }> {
  const ext = ALLOWED[file.type];
  if (!ext) throw new ApiError(415, "UNSUPPORTED_TYPE", "Format d'image non pris en charge (JPEG, PNG, GIF, WebP).");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "TOO_LARGE", "Image trop volumineuse (10 Mo max).");

  const now = new Date();
  const sub = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  const dir = path.join(uploadsDir(), sub);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { url: `/media/${sub}/${name}` };
}

/** Résout un chemin public /media/<rel> vers le disque, ou null s'il sort du répertoire. */
export function resolveMediaPath(segments: string[]): string | null {
  const root = uploadsDir();
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}
