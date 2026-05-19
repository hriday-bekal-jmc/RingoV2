/**
 * rolePermissionsCache — thin Redis-cached wrapper around role_permissions table.
 *
 * role_permissions is a tiny 8-row table that changes rarely (admin action only).
 * Cache in Redis with 60s TTL. Admin PATCH endpoint calls invalidate() so the
 * next request re-reads from DB immediately.
 *
 * Consumers:
 *   - requireAccounting middleware (can_settle check)
 *   - Any future middleware that needs dynamic role flags
 */
import { pool } from '../config/db';
import { redis } from '../config/redis';

const CACHE_KEY = 'role_perms:all';
const TTL_SEC   = 60;

interface RolePermEntry {
  canSubmit:  boolean;
  canApprove: boolean;
  canSettle:  boolean;
  canAdmin:   boolean;
}

type RolePermMap = Record<string, RolePermEntry>;

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

/** Returns all role permission entries (cached). */
export async function getRolePermissions(): Promise<RolePermMap> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as RolePermMap;
  } catch {
    // Redis down — fall through to DB.
  }

  const map = await loadFromDb();

  try {
    await redis.set(CACHE_KEY, JSON.stringify(map), 'EX', TTL_SEC);
  } catch {
    // Cache write failure is non-fatal.
  }

  return map;
}

/** Call after any admin mutation to role_permissions. */
export function invalidateRolePermissionsCache(): void {
  redis.del(CACHE_KEY).catch(() => {});
}

/** Convenience: can user with given role access settlement/accounting? */
export async function canRoleSettle(role: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const map = await getRolePermissions();
  return map[role]?.canSettle ?? false;
}
