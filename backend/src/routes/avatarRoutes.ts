/**
 * avatarRoutes — serve and manage user profile images.
 *
 * Industry-standard approach for 100-user internal app:
 *   • Images stored as files on disk (uploads/avatars/<userId>.jpg)
 *   • DB stores only a short URL string — no base64 blobs
 *   • GET /api/avatars/:userId served with 24h browser cache + stale-while-revalidate
 *   • Cache-busting via ?v=N (version incremented on each custom upload)
 *   • Fallback: server-generated SVG initials (zero storage, instant)
 *   • Google images downloaded to disk on login — no external URL in DB
 *
 * Auth: all routes require session cookie (same-origin img tags send cookies).
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { query } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { invalidateUserStateCache } from '../middlewares/authMiddleware';

const router = Router();

// ── Storage directory ──────────────────────────────────────────────────────────
export const AVATARS_DIR = path.join(process.cwd(), 'uploads', 'avatars');

export function ensureAvatarsDir(): void {
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}

// ── SVG initials fallback ──────────────────────────────────────────────────────
// Same gradient palette as frontend nameToColor() so fallback is visually consistent.
const GRADIENT_STOPS: [string, string][] = [
  ['#C75B47', '#E07B67'], // ringo
  ['#B08D1A', '#D4AA40'], // mustard
  ['#1A7A5E', '#2EA882'], // teal
  ['#6B5F57', '#8C7B72'], // warmgray
];

function generateInitialsSvg(name: string): string {
  const initial = (name ?? '').trim().slice(0, 1).toUpperCase() || '?';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const [c1, c2] = GRADIENT_STOPS[h % GRADIENT_STOPS.length];
  // Escape for SVG attribute safety
  const safeInit = initial.replace(/[<>&"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><text x="50%" y="50%" text-anchor="middle" dy="0.35em" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="18" font-weight="700" fill="white">${safeInit}</text></svg>`;
}

// ── Google image download helper ───────────────────────────────────────────────
// Call during OAuth login (synchronous so avatar is ready before login completes).
export async function downloadGoogleAvatar(pictureUrl: string, userId: string): Promise<void> {
  // Request 256×256 from Google (replaces size suffix like =s96-c or =s96)
  const url = pictureUrl.replace(/=s\d+-?c?$/, '=s256-c');

  ensureAvatarsDir();
  const filePath = path.join(AVATARS_DIR, `${userId}.jpg`);

  const transport = url.startsWith('https') ? https : http;

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    transport.get(url, (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        file.destroy();
        fs.unlink(filePath, () => {});
        reject(new Error(`Google avatar HTTP ${res.statusCode ?? 'unknown'}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlink(filePath, () => {}); reject(err); });
    }).on('error', (err) => {
      file.destroy();
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// ── GET /api/avatars/:userId ───────────────────────────────────────────────────
// Serve avatar file (JPEG) or generated SVG initials.
// Cache-Control is explicitly set here to override the global /api no-store middleware.
router.get('/:userId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  // Basic UUID format guard — prevent path traversal
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    res.status(400).json({ error: 'Invalid userId' });
    return;
  }

  const filePath = path.join(AVATARS_DIR, `${userId}.jpg`);

  if (fs.existsSync(filePath)) {
    // Serve file with aggressive browser caching.
    // Override the global /api no-store header by calling set() here (last writer wins).
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('Content-Type', 'image/jpeg');
    res.sendFile(path.resolve(filePath));
    return;
  }

  // No file — return SVG initials. Short TTL so a real image can replace it soon.
  try {
    const userRes = await query(
      `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const name: string = (userRes.rows[0] as { full_name?: string } | undefined)?.full_name ?? '?';
    const svg = generateInitialsSvg(name);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(svg);
  } catch {
    res.status(404).end();
  }
});

// ── POST /api/avatars/me ───────────────────────────────────────────────────────
// Upload custom avatar. Accepts base64 data URL (frontend resizes to 300×300 before sending).
router.post('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const { avatar_url: dataUrl } = req.body as { avatar_url?: string };
  if (!dataUrl) { res.status(400).json({ error: 'avatar_url is required' }); return; }

  if (!dataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'Must be a data:image/... URL' });
    return;
  }

  const match = dataUrl.match(/^data:image\/[\w+]+;base64,(.+)$/s);
  if (!match) {
    res.status(400).json({ error: 'Invalid data URL format' });
    return;
  }

  const buffer = Buffer.from(match[1], 'base64');
  // 300×300 JPEG at quality 85 ≈ 15–40 KB. Allow up to 300 KB.
  if (buffer.byteLength > 300_000) {
    res.status(413).json({ error: '画像サイズが大きすぎます（最大300KB）' });
    return;
  }

  try {
    ensureAvatarsDir();
    const filePath = path.join(AVATARS_DIR, `${userId}.jpg`);
    fs.writeFileSync(filePath, buffer);

    // Increment version + update avatar_url atomically (one round-trip)
    const result = await query(
      `UPDATE users
       SET avatar_version = avatar_version + 1,
           avatar_url     = '/api/avatars/' || id || '?v=' || (avatar_version + 1),
           updated_at     = NOW()
       WHERE id = $1
       RETURNING avatar_url`,
      [userId],
    );

    const newAvatarUrl = (result.rows[0] as { avatar_url?: string } | undefined)?.avatar_url;
    await invalidateUserStateCache(userId);
    res.json({ avatar_url: newAvatarUrl });
  } catch {
    res.status(500).json({ error: 'アバターの保存に失敗しました' });
  }
});

// ── DELETE /api/avatars/me ─────────────────────────────────────────────────────
// Remove custom avatar. Attempts to re-download stored Google picture URL.
router.delete('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

  try {
    // Delete file from disk
    const filePath = path.join(AVATARS_DIR, `${userId}.jpg`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Fetch stored Google URL
    const userRes = await query(
      `SELECT google_picture_url FROM users WHERE id = $1`,
      [userId],
    );
    const googleUrl = (userRes.rows[0] as { google_picture_url?: string | null } | undefined)?.google_picture_url;

    let newAvatarUrl: string | null = null;

    if (googleUrl) {
      try {
        await downloadGoogleAvatar(googleUrl, userId);
        // Always increment version on delete — never reuse a URL the browser has cached
        const vRes = await query(
          `UPDATE users SET avatar_version = avatar_version + 1, updated_at = NOW()
           WHERE id = $1 RETURNING avatar_version`,
          [userId],
        );
        const newV = (vRes.rows[0] as { avatar_version: number }).avatar_version;
        newAvatarUrl = `/api/avatars/${userId}?v=${newV}`;
        await query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [newAvatarUrl, userId]);
      } catch {
        // Google download failed — bump version, show initials
        await query(
          `UPDATE users SET avatar_version = avatar_version + 1, avatar_url = NULL, updated_at = NOW()
           WHERE id = $1`,
          [userId],
        );
      }
    } else {
      // No Google URL — bump version, clear → show initials
      await query(
        `UPDATE users SET avatar_version = avatar_version + 1, avatar_url = NULL, updated_at = NOW()
         WHERE id = $1`,
        [userId],
      );
    }

    await invalidateUserStateCache(userId);
    res.json({ avatar_url: newAvatarUrl });
  } catch {
    res.status(500).json({ error: 'アバターの削除に失敗しました' });
  }
});

export default router;
