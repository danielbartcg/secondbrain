import fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { contentTypeFor, resolveMediaPath } from "@/lib/uploads";

/**
 * GET /media/<année>/<mois>/<nom> — images collées dans les notes.
 *
 * Les noms de fichiers sont aléatoires (128 bits) : l'URL vaut capacité
 * d'accès, ce qui permet aux balises <img> (web et mobile) de charger les
 * visuels sans en-tête d'authentification. Le chemin est borné au
 * répertoire des uploads (anti-traversée) dans resolveMediaPath.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  if (!segments?.length || segments.some((s) => !/^[A-Za-z0-9._-]+$/.test(s))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const filePath = resolveMediaPath(segments);
  if (!filePath) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
