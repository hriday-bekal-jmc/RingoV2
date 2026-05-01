import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);

// GET /approvals/pending — only steps assigned to the current user (or unassigned)
// ADMIN sees all pending steps
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  const { id: userId, role } = req.user!;
  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.form_data, a.created_at,
         t.title_ja AS template_name,
         t.schema_definition,
         u.full_name AS applicant_name,
         u.avatar_url AS applicant_avatar,
         s.id AS current_step_id,
         s.step_order AS current_step,
         s.label AS current_step_label,
         s.action_type AS current_step_action,
         approver.full_name AS current_approver_name,
         approver.avatar_url AS current_approver_avatar,
         (SELECT COUNT(*) FROM approval_steps
          WHERE application_id = a.id AND stage = 'RINGI') AS total_steps
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       JOIN approval_steps s
         ON s.application_id = a.id AND s.status = 'PENDING' AND s.stage = 'RINGI'
       LEFT JOIN users approver ON s.approver_id = approver.id
       WHERE a.status = 'PENDING_APPROVAL'
         AND ($1 = 'ADMIN' OR s.approver_id = $2 OR s.approver_id IS NULL)
       ORDER BY a.created_at DESC`,
      [role, userId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[approvals] pending fetch failed:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

// POST /approvals/:id/approve — advance approval chain; issue number only on final step
router.post('/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const appRow = await client.query(
        `SELECT id, status, application_number, route_id FROM applications WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (appRow.rows.length === 0) throw Object.assign(new Error('Application not found'), { status: 404 });
      if (appRow.rows[0].status !== 'PENDING_APPROVAL') {
        throw Object.assign(new Error(`Cannot approve from status: ${appRow.rows[0].status}`), { status: 409 });
      }

      const currentStepRes = await client.query(
        `SELECT id, step_order, approver_id FROM approval_steps
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'
         ORDER BY step_order ASC LIMIT 1`,
        [id],
      );
      if (currentStepRes.rows.length === 0) {
        throw Object.assign(new Error('No pending approval step found — data inconsistency'), { status: 409 });
      }
      const currentStep = currentStepRes.rows[0] as { id: string; step_order: number; approver_id: string | null };

      // Only the assigned approver (or ADMIN) can approve their step
      const { id: userId, role } = req.user!;
      if (role !== 'ADMIN' && currentStep.approver_id && currentStep.approver_id !== userId) {
        throw Object.assign(
          new Error('この承認ステップはあなたに割り当てられていません。別の承認者が担当しています。'),
          { status: 403 },
        );
      }

      await client.query(
        `UPDATE approval_steps SET status = 'APPROVED', comment = $2, acted_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [currentStep.id, comment ?? null],
      );

      const nextStepRes = await client.query(
        `SELECT id, step_order FROM approval_steps
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'WAITING'
         ORDER BY step_order ASC LIMIT 1`,
        [id],
      );

      let updatedApp: Record<string, unknown>;

      if (nextStepRes.rows.length > 0) {
        const nextStep = nextStepRes.rows[0] as { id: string; step_order: number };
        await client.query(`UPDATE approval_steps SET status = 'PENDING' WHERE id = $1`, [nextStep.id]);
        const appRes = await client.query(
          `SELECT id, status, application_number FROM applications WHERE id = $1`, [id],
        );
        updatedApp = { ...appRes.rows[0], advanced_to_step: nextStep.step_order };
      } else {
        const seqRow = await client.query(`SELECT nextval('application_number_seq') AS n`);
        const year = new Date().getFullYear();
        const appNumber = `RNG-${year}-${String(seqRow.rows[0].n).padStart(6, '0')}`;
        const appRes = await client.query(
          `UPDATE applications
           SET status = 'APPROVED',
               application_number = COALESCE(application_number, $2),
               completed_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, status, application_number, completed_at`,
          [id, appNumber],
        );
        updatedApp = appRes.rows[0];
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_APPROVE', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ step: currentStep.step_order, comment: comment ?? null })],
      );

      return updatedApp;
    });

    const isFinal = (result as { status?: string }).status === 'APPROVED';
    res.json({
      message: isFinal ? '最終承認しました — 申請番号を発行しました' : '承認しました — 次の承認者に送付しました',
      application: result,
      final: isFinal,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[approvals] approve failed:', err);
    res.status(500).json({ error: '承認処理に失敗しました' });
  }
});

// POST /approvals/:id/return — return to applicant
router.post('/:id/return', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      const r = await client.query(
        `UPDATE applications SET status = 'RETURNED'
         WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING id`,
        [id],
      );
      if (r.rows.length === 0) throw Object.assign(new Error('差し戻しできない状態です'), { status: 409 });
      await client.query(
        `UPDATE approval_steps SET status = 'RETURNED', comment = $2, acted_at = CURRENT_TIMESTAMP
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'`,
        [id, comment ?? null],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_RETURN', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ comment: comment ?? null })],
      );
    });
    res.json({ message: '差し戻しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[approvals] return failed:', err);
    res.status(500).json({ error: '差し戻し処理に失敗しました' });
  }
});

// POST /approvals/:id/reject
router.post('/:id/reject', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      const r = await client.query(
        `UPDATE applications SET status = 'REJECTED'
         WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING id`,
        [id],
      );
      if (r.rows.length === 0) throw Object.assign(new Error('却下できない状態です'), { status: 409 });
      await client.query(
        `UPDATE approval_steps SET status = 'REJECTED', comment = $2, acted_at = CURRENT_TIMESTAMP
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'`,
        [id, comment ?? null],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_REJECT', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ comment: comment ?? null })],
      );
    });
    res.json({ message: '却下しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[approvals] reject failed:', err);
    res.status(500).json({ error: '却下処理に失敗しました' });
  }
});

export default router;
