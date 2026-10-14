import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { installerPath } from "@/lib/downloads";

/**
 * GET /downloads/:file — installateur publié de l'application desktop (public,
 * comme la page /app). Nom de fichier strictement contrôlé ; aucun autre accès disque.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const p = installerPath(file);
  if (!p) return new Response("Introuvable", { status: 404 });
  const stat = fs.statSync(p);
  return new Response(Readable.toWeb(fs.createReadStream(p)) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
