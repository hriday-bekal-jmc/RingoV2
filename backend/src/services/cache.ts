import { redis } from '../config/redis';

export async function getJsonCache<T>(key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) as T : null;
  } catch {
    return null;
  }
}

export async function setJsonCache(key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    await redis.setex(key, ttlSec, JSON.stringify(value));
  } catch {
    // Cache failures should not break request handling.
  }
}

// ── Stale-while-revalidate (SWR) ──────────────────────────────────────────────
// Serves a cached value INSTANTLY even after it goes "soft-stale", while
// recomputing it in the background. Users never wait on a cold recompute except
// the very first (truly empty) load. A delete/invalidation still forces a fresh
// compute on next read (correctness after a mutation).
//
//   softTtlSec → how long the value is considered fresh (served, no refresh)
//   hardTtlSec → Redis key lifetime; stale-but-present window = hard − soft.
//                Must be > softTtlSec so a stale value survives to be served.
//
// Single-flight: concurrent refreshes for the same key are coalesced via an
// in-process inflight map, so a popular key never triggers a recompute stampede.

interface SwrEnvelope<T> { v: T; freshUntil: number; } // freshUntil = epoch ms

const swrInflight = new Map<string, Promise<unknown>>();

function swrRefresh<T>(
  key: string,
  softTtlSec: number,
  hardTtlSec: number,
  producer: () => Promise<T>,
): Promise<T> {
  const existing = swrInflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = (async () => {
    const v = await producer();
    const env: SwrEnvelope<T> = { v, freshUntil: Date.now() + softTtlSec * 1000 };
    try {
      await redis.setex(key, hardTtlSec, JSON.stringify(env));
    } catch {
      // Cache write failure is non-fatal — value still returned to caller.
    }
    return v;
  })().finally(() => swrInflight.delete(key));

  swrInflight.set(key, p);
  return p;
}

export async function swrJson<T>(
  key: string,
  softTtlSec: number,
  hardTtlSec: number,
  producer: () => Promise<T>,
): Promise<T> {
  let env: SwrEnvelope<T> | null = null;
  try {
    const raw = await redis.get(key);
    if (raw) env = JSON.parse(raw) as SwrEnvelope<T>;
  } catch {
    // Redis down → fall through to a direct compute.
  }

  if (env) {
    if (Date.now() < env.freshUntil) return env.v;          // fresh → instant
    // Soft-stale → kick a background refresh, serve stale immediately.
    void swrRefresh(key, softTtlSec, hardTtlSec, producer).catch(() => { /* keep serving stale */ });
    return env.v;
  }

  // Cold (no value at all) → must compute now (single-flight, errors propagate).
  return swrRefresh(key, softTtlSec, hardTtlSec, producer);
}

export async function invalidateCachePattern(pattern: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch {
    return deleted;
  }

  return deleted;
}
