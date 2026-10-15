import type { NextRequest } from "next/server";
import { json, parseBody, withUser } from "@/lib/api";
import { decideMeeting } from "@/lib/meetings";
import { meetingDecisionSchema } from "@/lib/schemas-meetings";

type P = { meetingId: string };

/** POST /api/v1/meetings/:meetingId/decision — `{ decision: "APPROVED"|"REJECTED", comment }` (motif obligatoire pour un refus). */
export const POST = withUser<P>(async (req: NextRequest, { params, user }) => {
  const { decision, comment } = await parseBody(req, meetingDecisionSchema);
  return json({ meetings: await decideMeeting(user, params.meetingId, decision, comment) });
});
