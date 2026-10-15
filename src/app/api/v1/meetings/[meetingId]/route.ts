import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { deleteMeeting, updateMeeting } from "@/lib/meetings";
import { updateMeetingSchema } from "@/lib/schemas-meetings";

type P = { meetingId: string };

/** PATCH /api/v1/meetings/:meetingId — rédacteur ou propriétaire ; modifier le compte-rendu annule les validations. */
export const PATCH = withUser<P>(async (req: NextRequest, { params, user }) => {
  const input = await parseBody(req, updateMeetingSchema);
  return json({ meetings: await updateMeeting(user, params.meetingId, input) });
});

/** DELETE /api/v1/meetings/:meetingId */
export const DELETE = withUser<P>(async (_req, { params, user }) => json({ meetings: await deleteMeeting(user, params.meetingId) }));
