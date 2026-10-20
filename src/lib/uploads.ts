import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api";

/**
 * Stockage des fichiers :
 *  - images collées dans les notes → DATA_DIR/uploads (servies publiquement
 *    par /media/…, URL non devinable) ;
 *  - documents de projet → DATA_DIR/documents (téléchargement authentifié
 *    via /api/v1/documents/:id/download).
 *
 * Règles : allowlist de types MIME, taille bornée, nom aléatoire jamais dérivé
 * du nom client, accès disque borné au répertoire racine (anti-traversée).
 */

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Types acceptés pour les documents de projet (pas de SVG ni d'exécutables). */
const DOCUMENT_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  "application/pdf": "pdf",
  // HTML : servi en téléchargement ou, en aperçu, dans un document « sandbox » sans script (route de téléchargement).
  "text/html": "html",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
};
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

export function documentsDir(): string {
  return path.join(dataDir(), "documents");
}

function monthFolder(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function saveImage(file: File): Promise<{ url: string }> {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ApiError(415, "UNSUPPORTED_TYPE", "Format d'image non pris en charge (JPEG, PNG, GIF, WebP).");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "TOO_LARGE", "Image trop volumineuse (10 Mo max).");

  const sub = monthFolder();
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  const dir = path.join(uploadsDir(), sub);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { url: `/media/${sub}/${name}` };
}

/** Écrit un document de projet ; renvoie le chemin relatif à DATA_DIR/documents. */
export async function saveDocumentFile(file: File, projectId: string): Promise<{ storagePath: string; mimeType: string }> {
  const ext = DOCUMENT_TYPES[file.type] ?? (file.type === "application/octet-stream" ? guessExtension(file.name) : null);
  if (!ext) throw new ApiError(415, "UNSUPPORTED_TYPE", `Type de fichier non pris en charge (${file.type || "inconnu"}).`);
  if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "TOO_LARGE", "Document trop volumineux (25 Mo max).");
  if (file.size === 0) throw new ApiError(400, "BAD_REQUEST", "Fichier vide.");

  const safeProject = projectId.replace(/[^A-Za-z0-9_-]/g, "");
  const rel = `${safeProject}/${randomBytes(16).toString("hex")}.${ext}`;
  const dir = path.join(documentsDir(), safeProject);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(documentsDir(), rel), Buffer.from(await file.arrayBuffer()));
  const mimeType = file.type === "application/octet-stream" ? mimeFromExtension(ext) : file.type;
  return { storagePath: rel, mimeType };
}

/** Certains navigateurs envoient `application/octet-stream` : on se rabat sur l'extension connue. */
function guessExtension(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  return Object.values(DOCUMENT_TYPES).includes(ext) ? ext : null;
}

function mimeFromExtension(ext: string): string {
  const found = Object.entries(DOCUMENT_TYPES).find(([, e]) => e === ext);
  return found ? found[0] : "application/octet-stream";
}

export async function deleteDocumentFile(storagePath: string): Promise<void> {
  const target = resolveDocumentPath(storagePath);
  if (!target) return;
  await fs.rm(target, { force: true });
}

/** Supprime le répertoire documents/<projectId> (après suppression du projet ; au mieux). */
export async function deleteProjectDocumentsDir(projectId: string): Promise<void> {
  const safeProject = projectId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeProject) return;
  const target = resolveDocumentPath(safeProject);
  if (!target) return;
  await fs.rm(target, { recursive: true, force: true });
}

/** Résout un chemin public /media/<rel> vers le disque, ou null s'il sort du répertoire. */
export function resolveMediaPath(segments: string[]): string | null {
  return resolveWithin(uploadsDir(), segments);
}

export function resolveDocumentPath(storagePath: string): string | null {
  return resolveWithin(documentsDir(), storagePath.split("/"));
}

function resolveWithin(root: string, segments: string[]): string | null {
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
