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
