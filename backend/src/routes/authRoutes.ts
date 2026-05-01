import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db';
import type { JwtPayload } from '../middlewares/authMiddleware';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
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

function issueToken(user: Pick<UserRow, 'id' | 'email' | 'role' | 'department_id'>): string {
  const payload: JwtPayload = {
    id:            user.id,
    email:         user.email,
    role:          user.role,
    department_id: user.department_id,
  };
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '7d' });
}

function makeGoogleClient(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
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
router.post('/login', async (req: Request, res: Response): Promise<void> => {
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

    const token = issueToken(user);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, department_id: user.department_id } });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// POST /auth/logout
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ message: 'ログアウトしました' });
});

// GET /auth/google — redirect to Google OAuth consent screen
router.get('/google', (req: Request, res: Response): void => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'Google OAuth not configured — set GOOGLE_CLIENT_ID in .env' }); return;
  }
  const url = makeGoogleClient().generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

// GET /auth/google/callback — exchange code, find/create user, issue JWT
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const FRONTEND = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const { code, error } = req.query as { code?: string; error?: string };

  if (error || !code) { res.redirect(`${FRONTEND}/login?error=oauth_cancelled`); return; }

  try {
    const client = makeGoogleClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token as string,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) { res.redirect(`${FRONTEND}/login?error=oauth_failed`); return; }

    const { sub: google_sub, email, name, picture } = payload;

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

    const token = issueToken(user);
    res.cookie('token', token, COOKIE_OPTS);
    res.redirect(`${FRONTEND}/dashboard`);
  } catch (err) {
    console.error('[auth] google callback failed:', err);
    res.redirect(`${FRONTEND}/login?error=oauth_failed`);
  }
});

export default router;
