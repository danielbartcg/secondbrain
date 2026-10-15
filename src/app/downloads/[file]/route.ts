import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { installerPath, latestDesktop } from "@/lib/downloads";

/**
 * GET /downloads/:file — installateur publié de l'application desktop (public,
 * comme la page /app), ou `latest.json` (dernière version, lue par l'updater
 * de l'application). Nom de fichier strictement contrôlé ; aucun autre accès disque.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file === "latest.json") {
    const latest = latestDesktop();
    if (!latest) return Response.json({ error: "Aucune version publiée" }, { status: 404, headers: { "Cache-Control": "no-cache" } });
    const { platform, version, file: installer, size, sha256, publishedAt } = latest;
    return Response.json({ platform, version, file: installer, size, sha256, publishedAt }, { headers: { "Cache-Control": "no-cache" } });
  }
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
