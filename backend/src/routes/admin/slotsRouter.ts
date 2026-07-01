import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../../config/db';
import { validateBody } from '../../middlewares/validate';
import { invalidateChainPreviews } from '../applicationRoutes';
import {
  createSlotSchema, type CreateSlotBody,
  bulkUpdateSlotSchema, type BulkUpdateSlotBody,
  replaceApproverSchema, type ReplaceApproverBody,
} from '../../schemas/adminSchemas';

const router = Router();

// Seeded system slots — immutable, never deletable.
const SYSTEM_SLOT_CODES = new Set([
  'ringi_1','ringi_2','ringi_2_5','ringi_3','ringi_4','ringi_5','ringi_6',
  'settle_1','settle_2','settle_3','settle_4','settle_5','settle_6','settle_mgr',
  'confirm_1','confirm_2','confirm_3',
]);

// ─── Approval Slots catalog ───────────────────────────────────────────────────

router.get('/approval-slots', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT id, slot_code, label_ja, slot_type, sort_order
       FROM approval_slots ORDER BY sort_order ASC`,
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] approval-slots list failed:', err);
    res.status(500).json({ error: 'スロット一覧の取得に失敗しました' });
  }
});

router.post('/approval-slots', validateBody(createSlotSchema), async (req: Request, res: Response): Promise<void> => {
  const { label_ja, slot_type } = req.body as CreateSlotBody;
  const prefix = slot_type === 'RINGI' ? 'ringi' : slot_type === 'SETTLEMENT' ? 'settle' : 'confirm';
  try {
    const r = await withTransaction(async (client) => {
      const countRes = await client.query(
        `SELECT COUNT(*) AS cnt, COALESCE(MAX(sort_order), 0) AS max_order
         FROM approval_slots WHERE slot_type = $1`,
        [slot_type],
      );
      const n         = Number((countRes.rows[0] as any).cnt) + 1;
      const maxOrder  = Number((countRes.rows[0] as any).max_order);
      const slotCode  = `${prefix}_${n}`;
      const typeOffset = slot_type === 'RINGI' ? 0 : slot_type === 'SETTLEMENT' ? 100 : 200;
      const sortOrder = maxOrder > 0 ? maxOrder + 1 : typeOffset + n;
      const ins = await client.query(
        `INSERT INTO approval_slots (slot_code, label_ja, slot_type, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id, slot_code, label_ja, slot_type, sort_order`,
        [slotCode, label_ja, slot_type, sortOrder],
      );
      return ins.rows[0];
    });
    res.status(201).json(r);
  } catch (err) {
    console.error('[admin] create slot failed:', err);
    res.status(500).json({ error: 'スロットの作成に失敗しました' });
  }
});

// GET /admin/approval-slots/:id/usage — impact counts before deletion
router.get('/approval-slots/:id/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const slotRes = await query(`SELECT id, slot_code, label_ja FROM approval_slots WHERE id = $1`, [req.params.id]);
    if (slotRes.rows.length === 0) { res.status(404).json({ error: 'スロットが見つかりません' }); return; }
    const slot = slotRes.rows[0] as { id: string; slot_code: string; label_ja: string };

    const [userCount, patternCount, conditionCount] = await Promise.all([
      query(`SELECT COUNT(*) AS cnt FROM user_approval_slots  WHERE slot_id        = $1`, [req.params.id]),
      query(`SELECT COUNT(*) AS cnt FROM approval_pattern_slots WHERE slot_id      = $1`, [req.params.id]),
      query(`SELECT COUNT(*) AS cnt FROM approval_conditions WHERE stop_at_slot_id = $1`, [req.params.id]),
    ]);
    res.json({
      label_ja:          slot.label_ja,
      is_system:         SYSTEM_SLOT_CODES.has(slot.slot_code),
      user_assignments:  Number((userCount.rows[0] as any).cnt),
      pattern_count:     Number((patternCount.rows[0] as any).cnt),
      condition_count:   Number((conditionCount.rows[0] as any).cnt),
    });
  } catch (err) {
    console.error('[admin] slot usage failed:', err);
    res.status(500).json({ error: '使用状況の取得に失敗しました' });
  }
});

// DELETE /admin/approval-slots/:id
// Blocks system slots. CASCADE removes: pattern_slots, user_slots, dept_slots, conditions.
// In-flight approval_steps are unaffected (slot_id not stored on steps).
router.delete('/approval-slots/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const slotRes = await query(`SELECT id, slot_code FROM approval_slots WHERE id = $1`, [req.params.id]);
    if (slotRes.rows.length === 0) { res.status(404).json({ error: 'スロットが見つかりません' }); return; }
    const slot = slotRes.rows[0] as { id: string; slot_code: string };

    if (SYSTEM_SLOT_CODES.has(slot.slot_code)) {
      res.status(403).json({ error: 'システムスロットは削除できません。パターンから外すだけにしてください。' });
      return;
    }

    // Collect impact + affected user IDs before CASCADE removes them
    const [affectedUsersRes, patternCount, conditionCount] = await Promise.all([
      query(`SELECT DISTINCT user_id FROM user_approval_slots WHERE slot_id = $1`, [req.params.id]),
      query(`SELECT COUNT(*) AS cnt FROM approval_pattern_slots WHERE slot_id = $1`, [req.params.id]),
      query(`SELECT COUNT(*) AS cnt FROM approval_conditions WHERE stop_at_slot_id = $1`, [req.params.id]),
    ]);
    const affectedUserIds = affectedUsersRes.rows.map((r: { user_id: string }) => r.user_id);

    await query(`DELETE FROM approval_slots WHERE id = $1`, [req.params.id]);

    for (const uid of affectedUserIds) void invalidateChainPreviews(uid);

    res.json({
      message: 'スロットを削除しました',
      removed: {
        user_assignments: affectedUserIds.length,
        patterns:         Number((patternCount.rows[0] as any).cnt),
        conditions:       Number((conditionCount.rows[0] as any).cnt),
      },
    });
  } catch (err) {
    console.error('[admin] delete slot failed:', err);
    res.status(500).json({ error: 'スロットの削除に失敗しました' });
  }
});

// ─── Bulk slot operations ─────────────────────────────────────────────────────

router.post('/approval-slots/bulk-update', validateBody(bulkUpdateSlotSchema), async (req: Request, res: Response): Promise<void> => {
  const { department_id, slot_id, approver_id } = req.body as BulkUpdateSlotBody;
  try {
    const usersRes = await query(
      `SELECT id FROM users WHERE department_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [department_id],
    );
    const userIds = usersRes.rows.map((r: { id: string }) => r.id);
    if (userIds.length === 0) { res.json({ updated_count: 0 }); return; }

    const r = await query(
      `INSERT INTO user_approval_slots (user_id, slot_id, approver_id, updated_by)
       SELECT unnest($1::uuid[]), $2, $3, $4
       ON CONFLICT (user_id, slot_id) DO UPDATE
         SET approver_id = EXCLUDED.approver_id, updated_by = EXCLUDED.updated_by`,
      [userIds, slot_id, approver_id, req.user!.id],
    );
    for (const uid of userIds) void invalidateChainPreviews(uid);
    res.json({ updated_count: r.rowCount ?? 0 });
  } catch (err) {
    console.error('[admin] bulk-update slots failed:', err);
    res.status(500).json({ error: '一括更新に失敗しました' });
  }
});

router.post('/approval-slots/replace-approver', validateBody(replaceApproverSchema), async (req: Request, res: Response): Promise<void> => {
  const { from_user_id, to_user_id, slot_id } = req.body as ReplaceApproverBody;
  try {
    let updatedCount = 0;
    await withTransaction(async (client) => {
      const base = `UPDATE user_approval_slots SET approver_id = $1, updated_by = $2 WHERE approver_id = $3`;
      const r = slot_id
        ? await client.query(`${base} AND slot_id = $4`, [to_user_id, req.user!.id, from_user_id, slot_id])
        : await client.query(base, [to_user_id, req.user!.id, from_user_id]);
      updatedCount = r.rowCount ?? 0;
    });
    const affected = await query(
      `SELECT DISTINCT user_id FROM user_approval_slots WHERE approver_id = $1`,
      [to_user_id ?? from_user_id],
    );
    for (const row of affected.rows as { user_id: string }[]) void invalidateChainPreviews(row.user_id);
    res.json({ updated_count: updatedCount });
  } catch (err) {
    console.error('[admin] replace-approver failed:', err);
    res.status(500).json({ error: '一括置き換えに失敗しました' });
  }
});

export default router;
