import { NextResponse } from "next/server";
import { ApiError, withUser } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { buildProjectDeck } from "@/lib/project-pptx";

type P = { id: string };

/** GET /api/v1/projects/:id/export-pptx — présentation PowerPoint « état des lieux » du projet (membres du projet). */
export const GET = withUser<P>(async (_req, { params, user }) => {
  if (!rateLimit(`export:${user.id}`, 30, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop d'exports, réessayez dans quelques minutes.");
  const { buffer, filename } = await buildProjectDeck(user.id, params.id);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
