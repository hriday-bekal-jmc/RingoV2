import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/db';
import { redis } from '../config/redis';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  department_id: string | null;
  tv?: number;
  iat?: number;
  exp?: number;
}

export interface UserState {
  is_active: boolean;
  token_version: number;
  role: string;
}

const USER_STATE_TTL_SEC = 60;
const AUTH_PROFILE_PREFIX = 'auth_profile';
const userStateInflight = new Map<string, Promise<UserState | null>>();

export async function cacheUserState(userId: string, state: UserState): Promise<void> {
  try {
    await redis.set(`user_state:${userId}`, JSON.stringify(state), 'EX', USER_STATE_TTL_SEC);
  } catch {
    // Cache write failure should not block auth.
  }
}

// Cache user state in Redis and coalesce same-process misses. On first page load
// many authenticated requests start together; without this, each can miss Redis
// and run the same primary-key lookup before the first one populates the cache.
export async function loadUserState(userId: string): Promise<UserState | null> {
  const key = `user_state:${userId}`;
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as UserState;
  } catch {
    // Redis down: fall through to DB.
  }

  const inflight = userStateInflight.get(userId);
  if (inflight) return inflight;

  const loadPromise = (async (): Promise<UserState | null> => {
    const r = await query(
      `SELECT is_active, token_version, role FROM users WHERE id = $1`,
      [userId],
    );
    if (r.rows.length === 0) return null;

    const state: UserState = {
      is_active:     r.rows[0].is_active,
      token_version: r.rows[0].token_version ?? 0,
      role:          r.rows[0].role,
    };
    await cacheUserState(userId, state);
    return state;
  })();

  userStateInflight.set(userId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    userStateInflight.delete(userId);
  }
}

export function invalidateUserStateCache(userId: string): Promise<number> {
  userStateInflight.delete(userId);
  return redis.del(`user_state:${userId}`, `${AUTH_PROFILE_PREFIX}:${userId}`).catch(() => 0);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const state = await loadUserState(decoded.id);
  if (!state) { res.status(401).json({ error: 'User not found' }); return; }
  if (!state.is_active) { res.status(401).json({ error: 'Account disabled' }); return; }
  if ((decoded.tv ?? 0) !== state.token_version) {
    res.status(401).json({ error: 'Session revoked - please log in again' });
    return;
  }

  decoded.role = state.role;
  req.user = decoded;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
