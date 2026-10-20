import fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { attachmentForDownload } from "@/lib/attachments";

/**
 * GET /api/v1/attachments/:id/download — téléchargement authentifié (cookie ou
 * Bearer) d'une pièce jointe (commentaire, nœud). `?inline=1` pour un aperçu dans le
 * navigateur (PDF, images) au lieu d'un téléchargement.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { id } = await ctx.params;
    const doc = await attachmentForDownload(user.id, id);
    const data = await fs.readFile(doc.path);
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const safeName = doc.fileName.replace(/["\r\n]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        // Contenu téléversé : aucun script, aucune requête. `sandbox` (origine
        // opaque) sauf pour les PDF, que la visionneuse de Chrome refuse
        // d'afficher dans un document sandboxé.
        "Content-Security-Policy":
          doc.mimeType === "application/pdf"
            ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'"
            : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
