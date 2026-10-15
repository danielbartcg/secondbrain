/**
 * Rate limiting en mémoire (fenêtre glissante) — suffisant pour un
 * déploiement mono-instance. Protège les points sensibles au brute-force.
 */
interface Bucket {
  timestamps: number[];
  windowMs: number;
}

const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 60 * 1000;
/** Plafond mémoire : au-delà, purge des fenêtres expirées puis des plus anciennes clés. */
const MAX_BUCKETS = 50_000;
let lastCleanup = Date.now();

function cleanup(now: number): void {
  lastCleanup = now;
  for (const [k, bucket] of buckets) {
    if (bucket.timestamps.every((t) => now - t >= bucket.windowMs)) buckets.delete(k);
  }
  // Toujours trop : on évince les clés les plus anciennes (ordre d'insertion de la Map).
  if (buckets.size > MAX_BUCKETS) {
    let excess = buckets.size - MAX_BUCKETS;
    for (const k of buckets.keys()) {
      if (excess-- <= 0) break;
      buckets.delete(k);
    }
  }
}

/** Vrai si l'appel est autorisé pour `key` (moins de `limit` sur `windowMs`). */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL_MS || buckets.size >= MAX_BUCKETS) cleanup(now);
  const bucket = buckets.get(key) ?? { timestamps: [], windowMs };
  bucket.windowMs = Math.max(bucket.windowMs, windowMs);
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  // Réinsertion : la Map reste ordonnée de la clé la moins récemment utilisée à la plus récente.
  buckets.delete(key);
  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return true;
}

/** Erreur 429 homogène (message en français). */
export const RATE_LIMITED_MESSAGE = "Trop de requêtes, réessayez plus tard.";

/** Tentatives d'authentification : 10 / 15 min / clé. */
export function rateLimitAuth(key: string): boolean {
  return rateLimit(`auth:${key}`, 10, 15 * 60 * 1000);
}
