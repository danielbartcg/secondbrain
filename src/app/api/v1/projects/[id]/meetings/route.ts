import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { createMeeting, listMeetings } from "@/lib/meetings";
import { createMeetingSchema } from "@/lib/schemas-meetings";

type P = { id: string };

/** GET /api/v1/projects/:id/meetings — réunions du projet (plus récentes d'abord). */
export const GET = withUser<P>(async (_req, { params, user }) => json({ meetings: await listMeetings(user.id, params.id) }));

/** POST /api/v1/projects/:id/meetings — `{ title, date, location?, participantIds?, approverIds?, minutes? }`. */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, createMeetingSchema);
  return json({ meetings: await createMeeting(user, params.id, input) }, { status: 201 });
});
