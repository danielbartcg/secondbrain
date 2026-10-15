import { json, withUser } from "@/lib/api";
import { listContacts } from "@/lib/messages";

/** GET /api/v1/messages/contacts — personnes proposées pour une nouvelle conversation. */
export const GET = withUser(async (_req, { user }) => json({ contacts: await listContacts(user) }));
