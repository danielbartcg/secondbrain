/**
 * Rate limiting en mémoire (fenêtre glissante) — suffisant pour un
 * déploiement mono-instance. Protège les points sensibles au brute-force.
 */
interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

/** Vrai si l'appel est autorisé pour `key` (moins de `limit` sur `windowMs`). */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    for (const [k, bucket] of buckets) {
      if (bucket.timestamps.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return true;
}

/** Tentatives d'authentification : 10 / 15 min / clé. */
export function rateLimitAuth(key: string): boolean {
  return rateLimit(`auth:${key}`, 10, 15 * 60 * 1000);
}
