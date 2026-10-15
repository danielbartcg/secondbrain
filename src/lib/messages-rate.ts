import "server-only";
import { ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

/** Anti-abus de la messagerie : 300 envois / 15 min / utilisateur. */
export function requireMessageRate(userId: string) {
  if (!rateLimit(`messages:${userId}`, 300, 15 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Trop de messages envoyés, réessayez dans quelques minutes.");
}
