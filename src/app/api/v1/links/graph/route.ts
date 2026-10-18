import { json, withUser } from "@/lib/api";
import { getKnowledgeGraph } from "@/lib/links";

/** GET /api/v1/links/graph — graphe de connaissances (`{ graph: { nodes, edges, truncated } }`). */
export const GET = withUser(async (_req, { user }) => json({ graph: await getKnowledgeGraph(user.id) }));
