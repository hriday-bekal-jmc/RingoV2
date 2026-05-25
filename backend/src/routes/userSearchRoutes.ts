import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { redis } from '../config/redis';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
router.use(requireAuth);

const SEARCH_TTL  = 120;  // 2 min — user list changes infrequently
const DEPT_TTL    = 300;  // 5 min — departments change very rarely

// ── GET /api/users/departments ────────────────────────────────────────────────
// Returns all departments that have at least one active user.
// Used to populate department filter in UserPickerInput.
router.get('/departments', async (_req: Request, res: Response): Promise<void> => {
  const cacheKey = 'users:departments';
  try {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) { res.json(JSON.parse(cached)); return; }

    const r = await query(
      `SELECT d.id, d.name
       FROM departments d
       WHERE EXISTS (
         SELECT 1 FROM users u
         WHERE u.department_id = d.id AND u.is_active = TRUE
       )
       ORDER BY d.name`,
    );
    await redis.set(cacheKey, JSON.stringify(r.rows), 'EX', DEPT_TTL).catch(() => {});
    res.json(r.rows);
  } catch (err) {
    console.error('[users/departments] failed:', err);
    res.status(500).json({ error: '部署一覧の取得に失敗しました' });
  }
});

// ── GET /api/users/search ─────────────────────────────────────────────────────
// Search active users. Optional filters: dept_id, q (name/email).
// Paginated via limit + offset.
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  const q      = String(req.query.q ?? '').trim();
  const limit  = Math.min(Math.max(1, Number(req.query.limit ?? 20)), 50);
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  // dept_id explicit > dept_only (own dept) > none
  const deptId: string | null =
    req.query.dept_id
      ? String(req.query.dept_id)
      : req.query.dept_only === 'true'
        ? (req.user?.department_id ?? null)
        : null;

  const cacheKey = `users:search:${deptId ?? 'all'}:${encodeURIComponent(q)}:${offset}:${limit}`;

  try {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) { res.json(JSON.parse(cached)); return; }

    const conditions: string[] = ['u.is_active = TRUE'];
    const params: unknown[]    = [];

    if (deptId) {
      params.push(deptId);
      conditions.push(`u.department_id = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      const qIdx = params.length;
      conditions.push(`(u.full_name ILIKE $${qIdx} OR u.email ILIKE $${qIdx})`);
    }

    const where = conditions.join(' AND ');

    let orderBy = 'u.full_name';
    if (q) {
      params.push(`${q}%`);
      orderBy = `CASE WHEN u.full_name ILIKE $${params.length} THEN 0 ELSE 1 END, u.full_name`;
    }

    params.push(limit, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const r = await query(
      `SELECT u.id, u.full_name, u.email, u.avatar_url, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    await redis.set(cacheKey, JSON.stringify(r.rows), 'EX', SEARCH_TTL).catch(() => {});
    res.json(r.rows);
  } catch (err) {
    console.error('[users/search] failed:', err);
    res.status(500).json({ error: 'ユーザー検索に失敗しました' });
  }
});

export default router;
