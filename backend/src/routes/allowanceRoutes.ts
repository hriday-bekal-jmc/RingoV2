import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';

const router = Router();
router.use(requireAuth);

// GET /api/allowance-rates
// Returns all role rates + the calling user's personal daily rate.
// Used by AllowanceTab (admin) and TransportationForm (pre-fills rate display).
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const [ratesRes, userRes] = await Promise.all([
      query(
        `SELECT role, daily_rate_yen
         FROM allowance_rates
         ORDER BY daily_rate_yen DESC, role ASC`,
      ),
      query(
        `SELECT COALESCE(u.daily_allowance_rate, ar.daily_rate_yen) AS daily_allowance_rate
         FROM users u
         LEFT JOIN allowance_rates ar ON ar.role = u.role
         WHERE u.id = $1`,
        [req.user!.id],
      ),
    ]);

    res.json({
      rates: ratesRes.rows,
      user_daily_rate: (userRes.rows[0]?.daily_allowance_rate as number | null) ?? null,
    });
  } catch (err) {
    console.error('[allowance] fetch failed:', err);
    res.status(500).json({ error: '日当レートの取得に失敗しました' });
  }
});

// PATCH /api/allowance-rates/:role  (admin only)
// Updates rate for a role and immediately backfills all users with that role.
// This keeps users.daily_allowance_rate in sync without needing a cron job.
router.patch('/:role', requireAdmin, mutationLimiter, async (req: Request, res: Response): Promise<void> => {
  const { role } = req.params;
  const { daily_rate_yen } = req.body as { daily_rate_yen: unknown };

  if (typeof daily_rate_yen !== 'number' || daily_rate_yen < 0 || !Number.isInteger(daily_rate_yen)) {
    res.status(400).json({ error: 'daily_rate_yen は 0 以上の整数で入力してください' });
    return;
  }

  try {
    // Upsert rate
    await query(
      `INSERT INTO allowance_rates (role, daily_rate_yen)
       VALUES ($1, $2)
       ON CONFLICT (role) DO UPDATE
         SET daily_rate_yen = EXCLUDED.daily_rate_yen,
             updated_at     = NOW()`,
      [role, daily_rate_yen],
    );

    // Backfill all users with this role
    await query(
      `UPDATE users SET daily_allowance_rate = $1 WHERE role = $2`,
      [daily_rate_yen, role],
    );

    res.json({ message: '日当レートを更新しました', role, daily_rate_yen });
  } catch (err) {
    console.error('[allowance] update failed:', err);
    res.status(500).json({ error: '日当レートの更新に失敗しました' });
  }
});

export default router;
