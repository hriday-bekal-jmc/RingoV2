import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/db';
import { redis } from '../config/redis';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  department_id: string | null;
  tv?: number;          // token_version at issuance — must match users.token_version
  iat?: number;
  exp?: number;
}

interface UserState { is_active: boolean; token_version: number; role: string }

// Cache user state ~60s in Redis to avoid DB hit on every request.
// On disable / role change / logout-everywhere, the cache is invalidated
// (see authService when token_version is bumped).
async function loadUserState(userId: string): Promise<UserState | null> {
  const key = `user_state:${userId}`;
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as UserState;
  } catch {
    // Redis down — fall through to DB
  }
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
  try { await redis.set(key, JSON.stringify(state), 'EX', 60); } catch { /* ignore */ }
  return state;
}

export function invalidateUserStateCache(userId: string): Promise<number> {
  return redis.del(`user_state:${userId}`).catch(() => 0);
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

  // Live freshness check — disabled / demoted users cannot keep using old tokens
  const state = await loadUserState(decoded.id);
  if (!state) { res.status(401).json({ error: 'User not found' }); return; }
  if (!state.is_active) { res.status(401).json({ error: 'Account disabled' }); return; }
  if ((decoded.tv ?? 0) !== state.token_version) {
    res.status(401).json({ error: 'Session revoked — please log in again' });
    return;
  }
  // Trust DB role over JWT role (role may have changed since token issue)
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
