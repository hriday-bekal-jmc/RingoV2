import { invalidateCachePattern } from './cache';

export const ADMIN_REF_CACHE_TTL_SEC = 10 * 60;
export const ADMIN_REF_CACHE_PREFIX = 'admin:ref';

export function adminRefCacheKey(name: string): string {
  return `${ADMIN_REF_CACHE_PREFIX}:${name}:v1`;
}

export async function invalidateAdminReferenceCache(...names: string[]): Promise<void> {
  const targets = names.length > 0 ? names : ['*'];
  await Promise.all(
    targets.map((name) => invalidateCachePattern(`${ADMIN_REF_CACHE_PREFIX}:${name}*`)),
  );
}
