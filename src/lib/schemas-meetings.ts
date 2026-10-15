import { z } from "zod";

/** Validation des réunions et comptes-rendus (src/lib/meetings.ts). */
const id = z.string().min(1).max(64);
const isoDateTime = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Date invalide");

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(200),
  date: isoDateTime,
  location: z.string().trim().max(200).optional(),
  participantIds: z.array(id).max(200).optional(),
  approverIds: z.array(id).max(50).optional(),
  minutes: z.string().max(1_000_000).optional(),
});

export const updateMeetingSchema = createMeetingSchema.partial();

export const meetingDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(5000).default(""),
});
