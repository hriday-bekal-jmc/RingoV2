import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db';
import type { JwtPayload } from '../middlewares/authMiddleware';
import { authLimiter } from '../middlewares/rateLimit';
import { env } from '../config/env';

const router = Router();

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
  department_id: string | null;
  password_hash: string | null;
  google_oauth_sub: string | null;
  is_active: boolean;
}

async function issueToken(
  user: Pick<UserRow, 'id' | 'email' | 'role' | 'department_id'>,
): Promise<string> {
  // Embed current token_version so future bumps revoke this token live.
  const tvRow = await query(
    `SELECT token_version FROM users WHERE id = $1`,
    [user.id],
  );
  const tv = (tvRow.rows[0]?.token_version as number | undefined) ?? 0;
  const payload: JwtPayload = {
    id:            user.id,
    email:         user.email,
    role:          user.role,
    department_id: user.department_id,
    tv,
  };
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '7d' });
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
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department_id, u.avatar_url, d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [decoded.id],
    );
    if (result.rows.length === 0) { res.status(401).json({ error: 'User not found or disabled' }); return; }
    res.json({ user: result.rows[0] });
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
      `SELECT u.id, u.full_name, u.email, u.role, u.department_id, u.password_hash
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
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, department_id: user.department_id } });
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
       RETURNING id, full_name, email, role, department_id`,
      [full_name.trim(), decoded.id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    res.json({ user: result.rows[0] });
  } catch {
    res.status(500).json({ error: '更新に失敗しました' });
  }
});

// POST /auth/me/avatar — set custom avatar (base64 data URL, max ~200KB)
router.post('/me/avatar', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { avatar_url } = req.body as { avatar_url?: string };
  if (!avatar_url) { res.status(400).json({ error: 'avatar_url is required' }); return; }
  // Accept base64 data URLs or plain https URLs
  const isDataUrl = avatar_url.startsWith('data:image/');
  const isHttps = avatar_url.startsWith('https://');
  if (!isDataUrl && !isHttps) { res.status(400).json({ error: 'Invalid avatar URL format' }); return; }
  // Rough size guard: base64 of 300×300 JPEG ~= 30KB → 40000 chars is generous limit
  if (avatar_url.length > 400_000) { res.status(413).json({ error: '画像サイズが大きすぎます（最大300KB）' }); return; }
  try {
    const { default: jwt } = await import('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    await query(
      `UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [avatar_url, decoded.id],
    );
    res.json({ avatar_url });
  } catch {
    res.status(500).json({ error: 'アバターの更新に失敗しました' });
  }
});

// DELETE /auth/me/avatar — remove custom avatar (resets to Google photo or null)
router.delete('/me/avatar', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }
  try {
    const { default: jwt } = await import('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    // Try to find their Google picture by refreshing from google_oauth_sub
    const userRes = await query(
      `SELECT google_oauth_sub FROM users WHERE id = $1`,
      [decoded.id],
    );
    const user = userRes.rows[0] as { google_oauth_sub: string | null } | undefined;
    // Just clear it — next Google login will repopulate
    await query(
      `UPDATE users SET avatar_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [decoded.id],
    );
    res.json({ avatar_url: null, has_google: !!(user?.google_oauth_sub) });
  } catch {
    res.status(500).json({ error: 'アバターの削除に失敗しました' });
  }
});

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

    // ── Workspace domain enforcement: reject anyone whose ID token doesn't
    //    show the correct hosted-domain claim (or whose email isn't in it).
    if (env.GOOGLE_WORKSPACE_DOMAIN) {
      const allowed = env.GOOGLE_WORKSPACE_DOMAIN.toLowerCase();
      const tokenHd = (hd ?? '').toLowerCase();
      const emailDomain = (email ?? '').split('@')[1]?.toLowerCase() ?? '';
      if (tokenHd !== allowed || emailDomain !== allowed) {
        res.redirect(`${FRONTEND}/login?error=domain_not_allowed`);
        return;
      }
    }

    let userRes = await query(
      `SELECT id, full_name, email, role, department_id, is_active, google_oauth_sub
       FROM users WHERE google_oauth_sub = $1 OR email = $2 LIMIT 1`,
      [google_sub, email],
    );

    if (userRes.rows.length === 0) {
      userRes = await query(
        `INSERT INTO users (full_name, email, google_oauth_sub, avatar_url, role, is_active)
         VALUES ($1, $2, $3, $4, 'EMPLOYEE', TRUE)
         RETURNING id, full_name, email, role, department_id, is_active`,
        [name, email, google_sub, picture ?? null],
      );
    } else {
      // Always refresh avatar_url + link sub if needed
      await query(
        `UPDATE users SET google_oauth_sub = COALESCE(google_oauth_sub, $1), avatar_url = $2 WHERE id = $3`,
        [google_sub, picture ?? null, userRes.rows[0].id],
      );
    }

    const user = userRes.rows[0] as UserRow;
    if (!user.is_active) { res.redirect(`${FRONTEND}/login?error=account_disabled`); return; }

    const token = await issueToken(user);
    res.cookie('token', token, COOKIE_OPTS);
    res.redirect(`${FRONTEND}/dashboard`);
  } catch (err) {
    console.error('[auth] google callback failed:', err);
    res.redirect(`${FRONTEND}/login?error=oauth_failed`);
  }
});

export default router;
