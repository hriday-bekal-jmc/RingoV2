import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db';
import {
  cacheUserState,
  invalidateUserStateCache,
  loadUserState,
  type JwtPayload,
} from '../middlewares/authMiddleware';
import { authLimiter } from '../middlewares/rateLimit';
import { env, SUPER_ADMIN_EMAILS } from '../config/env';
import { downloadGoogleAvatar } from './avatarRoutes';
import { getJsonCache, setJsonCache } from '../services/cache';

const router = Router();
const AUTH_PROFILE_TTL_SEC = 5 * 60;
const authProfileInflight = new Map<string, Promise<Record<string, unknown> | null>>();

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_admin: boolean;
  department_id: string | null;
  password_hash: string | null;
  google_oauth_sub: string | null;
  is_active: boolean;
}

async function issueToken(
  user: Pick<UserRow, 'id' | 'email' | 'role' | 'is_admin' | 'department_id'>,
): Promise<string> {
  // Embed current token_version so future bumps revoke this token live.
  const tvRow = await query(
    `SELECT token_version, is_admin FROM users WHERE id = $1`,
    [user.id],
  );
  const tv = (tvRow.rows[0]?.token_version as number | undefined) ?? 0;
  const isAdmin = Boolean(tvRow.rows[0]?.is_admin) || user.is_admin || SUPER_ADMIN_EMAILS.has(user.email.toLowerCase());
  const payload: JwtPayload = {
    id:            user.id,
    email:         user.email,
    role:          user.role,
    is_admin:      isAdmin,
    department_id: user.department_id,
    tv,
  };
  await cacheUserState(user.id, { is_active: true, token_version: tv, role: user.role, is_admin: isAdmin });
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '7d' });
}

async function loadAuthProfile(userId: string): Promise<Record<string, unknown> | null> {
  const key = `auth_profile:${userId}`;
  const cached = await getJsonCache<Record<string, unknown>>(key);
  if (cached) return cached;

  const inflight = authProfileInflight.get(userId);
  if (inflight) return inflight;

  const loadPromise = (async (): Promise<Record<string, unknown> | null> => {
    const [profileRes, overridesRes] = await Promise.all([
      query(
        `SELECT u.id, u.full_name, u.email, u.role, u.is_admin, u.department_id, u.avatar_url,
                COALESCE(u.daily_allowance_rate, ar.daily_rate_yen) AS daily_allowance_rate,
                d.name AS department_name,
                u.notify_email, u.notify_gchat, u.gchat_webhook_url
         FROM users u
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN allowance_rates ar ON ar.role = u.role
         WHERE u.id = $1 AND u.is_active = TRUE`,
        [userId],
      ),
      query(
        `SELECT capability FROM user_capability_overrides WHERE user_id = $1`,
        [userId],
      ),
    ]);
    const user = profileRes.rows[0] as Record<string, unknown> | undefined;
    if (!user) return null;
    user.cap_overrides = overridesRes.rows.map((r: any) => r.capability as string);
    await setJsonCache(key, user, AUTH_PROFILE_TTL_SEC);
    return user;
  })();

  authProfileInflight.set(userId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    authProfileInflight.delete(userId);
  }
}

function makeGoogleClient(): OAuth2Client {
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3000/api/auth/google/callback',
  );
}

// GET /auth/me — verify cookie and return full user
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const state = await loadUserState(decoded.id);
    if (!state || !state.is_active) { res.status(401).json({ error: 'User not found or disabled' }); return; }
    if ((decoded.tv ?? 0) !== state.token_version) {
      res.status(401).json({ error: 'Session revoked - please log in again' });
      return;
    }
    const user = await loadAuthProfile(decoded.id);
    if (!user) { res.status(401).json({ error: 'User not found or disabled' }); return; }
    user.is_admin = Boolean(user.is_admin) || SUPER_ADMIN_EMAILS.has(String(user.email).toLowerCase());
    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /auth/login — email + password
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) { res.status(400).json({ error: 'メールとパスワードを入力してください' }); return; }

  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.is_admin, u.department_id, u.password_hash
       FROM users u WHERE u.email = $1 AND u.is_active = TRUE`,
      [email.toLowerCase().trim()],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'メールまたはパスワードが正しくありません' }); return;
    }

    const user = result.rows[0] as UserRow;
    if (!user.password_hash) {
      res.status(401).json({ error: 'このアカウントはGoogleログインのみ対応しています' }); return;
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) { res.status(401).json({ error: 'メールまたはパスワードが正しくありません' }); return; }

    const token = await issueToken(user);
    await loadAuthProfile(user.id);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        is_admin: Boolean(user.is_admin) || SUPER_ADMIN_EMAILS.has(user.email.toLowerCase()),
        department_id: user.department_id,
      },
    });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// PATCH /auth/me — update own profile (name only)
router.patch('/me', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { full_name } = req.body as { full_name?: string };
  if (!full_name?.trim()) { res.status(400).json({ error: '名前を入力してください' }); return; }
  try {
    const { default: jwt } = await import('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    const result = await query(
      `UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND is_active = TRUE
       RETURNING id, full_name, email, role, is_admin, department_id`,
      [full_name.trim(), decoded.id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    await invalidateUserStateCache(decoded.id);
    res.json({ user: result.rows[0] });
  } catch {
    res.status(500).json({ error: '更新に失敗しました' });
  }
});

// PATCH /auth/me/notifications — update own notification preferences
router.patch('/me/notifications', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const { notify_email, notify_gchat, gchat_webhook_url } = req.body as {
    notify_email?: boolean;
    notify_gchat?: boolean;
    gchat_webhook_url?: string | null;
  };

  // Validate webhook URL if provided and non-empty
  if (gchat_webhook_url && !gchat_webhook_url.startsWith('https://chat.googleapis.com/')) {
    res.status(400).json({ error: 'Google Chat Webhook URLが無効です' }); return;
  }

  try {
    const { default: jwtLib } = await import('jsonwebtoken');
    const decoded = jwtLib.verify(token, process.env.JWT_SECRET as string) as { id: string };

    const r = await query(
      `UPDATE users
       SET notify_email      = COALESCE($1, notify_email),
           notify_gchat      = COALESCE($2, notify_gchat),
           gchat_webhook_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE gchat_webhook_url END,
           updated_at        = NOW()
       WHERE id = $4 AND is_active = TRUE
       RETURNING id, notify_email, notify_gchat, gchat_webhook_url`,
      [
        notify_email ?? null,
        notify_gchat ?? null,
        gchat_webhook_url !== undefined ? (gchat_webhook_url || null) : null,
        decoded.id,
      ],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    res.json({ notifications: r.rows[0] });
  } catch {
    res.status(500).json({ error: '通知設定の更新に失敗しました' });
  }
});

// Avatar endpoints moved to /api/avatars/ (avatarRoutes.ts)

// POST /auth/logout
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ message: 'ログアウトしました' });
});

// GET /auth/google — redirect to Google OAuth consent screen
router.get('/google', authLimiter, (req: Request, res: Response): void => {
  if (!env.GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'Google OAuth not configured — set GOOGLE_CLIENT_ID in .env' }); return;
  }
  // CSRF protection: random state stored in HttpOnly cookie, echoed by Google,
  // verified on callback. Without this, an attacker can trick a victim into
  // logging into the attacker's account (login CSRF / session fixation).
  const state = crypto.randomBytes(32).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure:   env.NODE_ENV === 'production',
    sameSite: 'lax', // 'lax' so it survives the Google redirect back to us
    maxAge:   10 * 60 * 1000, // 10 minutes
  });

  const opts: Parameters<OAuth2Client['generateAuthUrl']>[0] = {
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'select_account',
    state,
  };
  // Restrict consent screen to a single Workspace domain when configured.
  // Note: hd is a UI hint — we still validate hd in the ID token below.
  if (env.GOOGLE_WORKSPACE_DOMAIN) opts.hd = env.GOOGLE_WORKSPACE_DOMAIN;

  res.redirect(makeGoogleClient().generateAuthUrl(opts));
});

// GET /auth/google/callback — exchange code, find/create user, issue JWT
router.get('/google/callback', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const FRONTEND = env.FRONTEND_ORIGIN;
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };

  if (error || !code) { res.redirect(`${FRONTEND}/login?error=oauth_cancelled`); return; }

  // ── Verify state (CSRF defence) — must match the value we set in the cookie
  const cookieState = req.cookies?.oauth_state as string | undefined;
  res.clearCookie('oauth_state');
  if (!cookieState || !state || cookieState !== state) {
    console.warn('[auth] rejected OAuth callback: state mismatch', {
      ip: req.ip,
      hasCookieState: Boolean(cookieState),
      hasQueryState: Boolean(state),
      userAgent: req.get('user-agent') ?? 'unknown',
    });
    res.redirect(`${FRONTEND}/login?error=oauth_state_mismatch`);
    return;
  }

  try {
    const client = makeGoogleClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token as string,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) { res.redirect(`${FRONTEND}/login?error=oauth_failed`); return; }

    const { sub: google_sub, email, name, picture, hd } = payload;
    const normalizedEmail = email?.toLowerCase().trim();
    if (!normalizedEmail) {
      res.redirect(`${FRONTEND}/login?error=oauth_failed`);
      return;
    }

    // ── Workspace domain enforcement: reject anyone whose ID token doesn't
    //    show the correct hosted-domain claim (or whose email isn't in it).
    if (env.GOOGLE_WORKSPACE_DOMAIN) {
      const allowed = env.GOOGLE_WORKSPACE_DOMAIN.toLowerCase();
      const tokenHd = (hd ?? '').toLowerCase();
      const emailDomain = normalizedEmail.split('@')[1]?.toLowerCase() ?? '';
      if (tokenHd !== allowed || emailDomain !== allowed) {
        res.redirect(`${FRONTEND}/login?error=domain_not_allowed`);
        return;
      }
    }

    let userRes = await query(
      `SELECT id, full_name, email, role, is_admin, department_id, is_active, google_oauth_sub, avatar_version
       FROM users WHERE google_oauth_sub = $1 LIMIT 1`,
      [google_sub],
    );

    if (userRes.rows.length === 0) {
      userRes = await query(
        `SELECT id, full_name, email, role, is_admin, department_id, is_active, google_oauth_sub, avatar_version
         FROM users WHERE lower(email) = $1 LIMIT 1`,
        [normalizedEmail],
      );
    }

    if (userRes.rows.length === 0) {
      // New user — no avatar yet; will be downloaded below
      userRes = await query(
        `INSERT INTO users (full_name, email, google_oauth_sub, google_picture_url, role, is_active)
         VALUES ($1, $2, $3, $4, 'EMPLOYEE', TRUE)
         RETURNING id, full_name, email, role, is_admin, department_id, is_active, avatar_version`,
        [name, normalizedEmail, google_sub, picture ?? null],
      );
    } else {
      // Existing user — store latest Google picture URL but never overwrite a custom upload
      await query(
        `UPDATE users
         SET google_oauth_sub   = COALESCE(google_oauth_sub, $1),
             google_picture_url = $2,
             updated_at         = NOW()
         WHERE id = $3`,
        [google_sub, picture ?? null, userRes.rows[0].id],
      );
    }

    // ── Download Google avatar to disk if user has no custom upload ────────────
    // avatar_version = 0 → Google/default image; > 0 → custom upload (never overwrite)
    const userId = (userRes.rows[0] as { id: string }).id;
    const avatarVersion = Number((userRes.rows[0] as { avatar_version?: number }).avatar_version ?? 0);
    if (picture && avatarVersion === 0) {
      try {
        await downloadGoogleAvatar(picture, userId);
        // Update avatar_url to the local endpoint URL (overwrites only if version still 0)
        await query(
          `UPDATE users
           SET avatar_url = $1, updated_at = NOW()
           WHERE id = $2 AND avatar_version = 0`,
          [`/api/avatars/${userId}?v=0`, userId],
        );
      } catch (dlErr) {
        const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
        console.warn(`[avatar] Google download failed for ${userId}: ${msg}`);
        // Non-fatal — user will see gradient initials
      }
    }

    const user = userRes.rows[0] as UserRow;
    if (!user.is_active) { res.redirect(`${FRONTEND}/login?error=account_disabled`); return; }

    await invalidateUserStateCache(user.id);
    const token = await issueToken(user);
    await loadAuthProfile(user.id);
    res.cookie('token', token, COOKIE_OPTS);
    res.redirect(`${FRONTEND}/dashboard`);
  } catch (err) {
    console.error('[auth] google callback failed:', err);
    res.redirect(`${FRONTEND}/login?error=oauth_failed`);
  }
});

export default router;
