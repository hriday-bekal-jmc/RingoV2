import { Router, Request, Response } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { pool } from '../config/db';

const router = Router();
router.use(requireAuth);

interface RolePermRow {
  role: string;
  can_submit: boolean;
  can_approve: boolean;
  can_settle: boolean;
  can_admin: boolean;
  nav_pages: string[];
}

// GET /api/permissions — auth-gated, returns all role_permissions as dict keyed by role
router.get('/permissions', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<RolePermRow>('SELECT * FROM role_permissions ORDER BY role');
    const data: Record<string, {
      canSubmit: boolean;
      canApprove: boolean;
      canSettle: boolean;
      canAdmin: boolean;
      navPages: string[];
    }> = {};

    for (const row of result.rows) {
      data[row.role] = {
        canSubmit:  row.can_submit,
        canApprove: row.can_approve,
        canSettle:  row.can_settle,
        canAdmin:   row.can_admin,
        navPages:   row.nav_pages,
      };
    }

    res.json(data);
  } catch (err) {
    console.error('[permissions] fetch failed:', err);
    res.status(500).json({ error: '権限情報の取得に失敗しました' });
  }
});

export default router;
