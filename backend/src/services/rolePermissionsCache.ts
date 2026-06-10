/**
 * rolePermissionsCache — two-tier cache over the tiny role_permissions table.
 *
 * role_permissions is an 8-row table read on (nearly) every authenticated
 * request that does a capability check, but mutated only by an admin action.
 * That read pattern is the hottest in the app, so we serve it from a two-tier
 * cache:
 *
 *   L1  in-process Map (30s TTL)  → 0 network hops, sub-microsecond
 *   L2  Redis (60s TTL)           → shared across instances, survives restart
 *   DB                            → source of truth on full miss
 *
 * Single-flight: concurrent L1 misses for the key are coalesced so a cold
 * cache never stampedes the DB.
 *
 * Invalidation (admin PATCH): clears L1 on THIS instance instantly + deletes
 * the Redis key. On a multi-instance deployment, other instances pick up the
 * change within their L1 TTL (≤30s) — acceptable bounded staleness for an
 * admin-only permissions table. (Single-instance → instant + exact.)
 *
 * Consumers:
 *   - requireAccounting middleware (can_settle check)
 *   - Any middleware/route that needs dynamic role flags
 */
import { pool } from '../config/db';
import { redis } from '../config/redis';

const CACHE_KEY   = 'role_perms:all';
const TTL_SEC     = 60;          // L2 (Redis)
const L1_TTL_MS   = 30 * 1_000;  // L1 (in-process) — ≤ L2 so it never serves older than Redis

interface RolePermEntry {
  canSubmit:  boolean;
  canApprove: boolean;
  canSettle:  boolean;
  canAdmin:   boolean;
}

type RolePermMap = Record<string, RolePermEntry>;

// ── L1 in-process cache + single-flight ──────────────────────────────────────
let l1: { map: RolePermMap; expiresAt: number } | null = null;
let inflight: Promise<RolePermMap> | null = null;

async function loadFromDb(): Promise<RolePermMap> {
  const { rows } = await pool.query<{
    role:        string;
    can_submit:  boolean;
    can_approve: boolean;
    can_settle:  boolean;
    can_admin:   boolean;
  }>('SELECT role, can_submit, can_approve, can_settle, can_admin FROM role_permissions');

  const map: RolePermMap = {};
  for (const r of rows) {
    map[r.role] = {
      canSubmit:  r.can_submit,
      canApprove: r.can_approve,
      canSettle:  r.can_settle,
      canAdmin:   r.can_admin,
    };
  }
  return map;
}

/** Returns all role permission entries (two-tier cached). */
export async function getRolePermissions(): Promise<RolePermMap> {
  // L1 — in-process, no network.
  if (l1 && Date.now() < l1.expiresAt) return l1.map;

  // Coalesce concurrent misses (single-flight) so a cold cache hits L2/DB once.
  if (inflight) return inflight;

  inflight = (async () => {
    // L2 — Redis.
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const map = JSON.parse(cached) as RolePermMap;
        l1 = { map, expiresAt: Date.now() + L1_TTL_MS };
        return map;
      }
    } catch {
      // Redis down — fall through to DB.
    }

    // DB — source of truth. Backfill both tiers.
    const map = await loadFromDb();
    l1 = { map, expiresAt: Date.now() + L1_TTL_MS };
    try {
      await redis.set(CACHE_KEY, JSON.stringify(map), 'EX', TTL_SEC);
    } catch {
      // Cache write failure is non-fatal.
    }
    return map;
  })().finally(() => { inflight = null; });

  return inflight;
}

/** Call after any admin mutation to role_permissions. */
export function invalidateRolePermissionsCache(): void {
  l1 = null;                       // clear THIS instance's L1 immediately
  redis.del(CACHE_KEY).catch(() => {});
}

/** Convenience: can user with given role (or personal overrides) access settlement/accounting? */
export async function canRoleSettle(role: string, isAdmin: boolean, capOverrides?: string[]): Promise<boolean> {
  if (isAdmin) return true;
  if (capOverrides?.includes('can_settle')) return true;
  const map = await getRolePermissions();
  return map[role]?.canSettle ?? false;
}

export async function canRoleApprove(role: string, isAdmin: boolean, capOverrides?: string[]): Promise<boolean> {
  if (isAdmin) return true;
  if (capOverrides?.includes('can_approve')) return true;
  const map = await getRolePermissions();
  return map[role]?.canApprove ?? false;
}

export async function canRoleAdmin(role: string, isAdmin: boolean, capOverrides?: string[]): Promise<boolean> {
  if (isAdmin) return true;
  if (capOverrides?.includes('can_admin')) return true;
  const map = await getRolePermissions();
  return map[role]?.canAdmin ?? false;
}
