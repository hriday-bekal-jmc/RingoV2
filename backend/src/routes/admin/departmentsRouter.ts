import { Router, Request, Response } from 'express';
import { query } from '../../config/db';
import { getJsonCache, setJsonCache } from '../../services/cache';
import { validateBody } from '../../middlewares/validate';
import {
  ADMIN_REF_CACHE_TTL_SEC,
  adminRefCacheKey,
} from '../../services/adminReferenceCache';
import { upsertDeptSlotsSchema, type UpsertDeptSlotsBody } from '../../schemas/adminSchemas';

const router = Router();

// ─── Departments ──────────────────────────────────────────────────────────────

router.get('/departments', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = adminRefCacheKey('departments');
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    const result = await query(`SELECT id, name, code FROM departments ORDER BY created_at`);
    void setJsonCache(cacheKey, result.rows, ADMIN_REF_CACHE_TTL_SEC);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '部署一覧の取得に失敗しました' });
  }
});

// ─── Department approval slots ────────────────────────────────────────────────

router.get('/departments/:id/approval-slots', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT s.id AS slot_id, s.slot_code, s.label_ja, s.slot_type, s.sort_order,
              das.approver_id,
              u.full_name AS approver_name
       FROM approval_slots s
       LEFT JOIN dept_approval_slots das ON das.slot_id = s.id AND das.department_id = $1
       LEFT JOIN users u ON u.id = das.approver_id
       ORDER BY s.sort_order ASC`,
      [req.params.id],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] dept slots GET failed:', err);
    res.status(500).json({ error: '部署スロットの取得に失敗しました' });
  }
});

router.put('/departments/:id/approval-slots', validateBody(upsertDeptSlotsSchema), async (req: Request, res: Response): Promise<void> => {
  const { slots } = req.body as UpsertDeptSlotsBody;
  try {
    await query(
      `INSERT INTO dept_approval_slots (department_id, slot_id, approver_id, updated_by)
       SELECT $1, unnest($2::uuid[]), unnest($3::uuid[]), $4
       ON CONFLICT (department_id, slot_id) DO UPDATE
         SET approver_id = EXCLUDED.approver_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [req.params.id, slots.map(s => s.slot_id), slots.map(s => s.approver_id), req.user!.id],
    );
    res.json({ message: '部署スロットを保存しました' });
  } catch (err) {
    console.error('[admin] dept slots PUT failed:', err);
    res.status(500).json({ error: '部署スロットの保存に失敗しました' });
  }
});

export default router;
