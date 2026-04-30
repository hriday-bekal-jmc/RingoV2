import { Router } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db.js';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function makeGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  );
}

// GET /auth/me — verify cookie and return full user
router.get('/me', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [decoded.id],
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found or disabled' });
    res.json({ user: result.rows[0] });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /auth/login — email + password
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'メールとパスワードを入力してください' });

  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department_id, u.password_hash
       FROM users u WHERE u.email = $1 AND u.is_active = TRUE`,
      [email.toLowerCase().trim()],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'メールまたはパスワードが正しくありません' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'このアカウントはGoogleログインのみ対応しています' });
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) return res.status(401).json({ error: 'メールまたはパスワードが正しくありません' });

    const token = issueToken(user);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, department_id: user.department_id },
    });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ message: 'ログアウトしました' });
});

// GET /auth/google — redirect to Google OAuth consent screen
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google OAuth not configured — set GOOGLE_CLIENT_ID in .env' });
  }
  const url = makeGoogleClient().generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

// GET /auth/google/callback — exchange code, find/create user, issue JWT
router.get('/google/callback', async (req, res) => {
  const FRONTEND = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${FRONTEND}/login?error=oauth_cancelled`);
  }

  try {
    const client = makeGoogleClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: google_sub, email, name } = ticket.getPayload();

    // Find existing user by Google sub or email
    let userRes = await query(
      `SELECT id, full_name, email, role, department_id, is_active, google_oauth_sub
       FROM users WHERE google_oauth_sub = $1 OR email = $2 LIMIT 1`,
      [google_sub, email],
    );

    if (userRes.rows.length === 0) {
      // New user — create with EMPLOYEE role, admin assigns dept later
      userRes = await query(
        `INSERT INTO users (full_name, email, google_oauth_sub, role, is_active)
         VALUES ($1, $2, $3, 'EMPLOYEE', TRUE)
         RETURNING id, full_name, email, role, department_id, is_active`,
        [name, email, google_sub],
      );
    } else if (!userRes.rows[0].google_oauth_sub) {
      // Existing password user — link Google sub
      await query(`UPDATE users SET google_oauth_sub = $1 WHERE id = $2`, [google_sub, userRes.rows[0].id]);
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      return res.redirect(`${FRONTEND}/login?error=account_disabled`);
    }

    const token = issueToken(user);
    res.cookie('token', token, COOKIE_OPTS);
    res.redirect(`${FRONTEND}/dashboard`);
  } catch (err) {
    console.error('[auth] google callback failed:', err);
    res.redirect(`${FRONTEND}/login?error=oauth_failed`);
  }
});

export default router;
