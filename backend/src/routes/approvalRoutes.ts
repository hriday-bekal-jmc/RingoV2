import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { assertCanActOnStep } from '../middlewares/authz';
import { emitAll } from './sseRoutes';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);

// GET /approvals/pending — steps assigned to current user  (paginated)
// ?all=true (ADMIN only) → system-wide view
// ?limit=25&offset=0
const APPROVAL_PAGE_SIZE = 25;
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  const { id: userId, role } = req.user!;
  const systemView = role === 'ADMIN' && req.query.all === 'true';
  const limit  = Math.min(Number(req.query.limit  ?? APPROVAL_PAGE_SIZE), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.form_data, a.settlement_data, a.created_at,
         t.title_ja AS template_name,
         t.schema_definition, t.settlement_schema,
         u.full_name AS applicant_name,
         u.avatar_url AS applicant_avatar,
         s.id AS current_step_id,
         (s.step_order - (s.step_order / 100) * 100) AS current_step,
         s.stage AS current_stage,
         s.label AS current_step_label,
         s.action_type AS current_step_action,
         approver.full_name AS current_approver_name,
         approver.avatar_url AS current_approver_avatar,
         (SELECT COUNT(*) FROM approval_steps
          WHERE application_id = a.id AND stage = s.stage
            AND step_order / 100 = s.step_order / 100) AS total_steps,
         COUNT(*) OVER() AS total_count
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       JOIN approval_steps s
         ON s.application_id = a.id AND s.status = 'PENDING'
       LEFT JOIN users approver ON s.approver_id = approver.id
       WHERE a.status IN ('PENDING_APPROVAL', 'PENDING_SETTLEMENT')
         AND ($1 OR s.approver_id = $2)
       ORDER BY a.created_at DESC
       LIMIT $3 OFFSET $4`,
      [systemView, userId, limit + 1, offset],
    );
    const rows    = result.rows;
    const total   = Number(rows[0]?.total_count ?? 0);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    // strip internal total_count from each row
    const items = rows.map(({ total_count: _, ...r }) => r);
    res.json({ items, hasMore, total, offset });
  } catch (err) {
    console.error('[approvals] pending fetch failed:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

// POST /approvals/:id/approve
router.post('/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };
  const { id: userId, role } = req.user!;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock the application row
      const appRow = await client.query(
        `SELECT id, status, application_number, route_id FROM applications WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (appRow.rows.length === 0) throw Object.assign(new Error('Application not found'), { status: 404 });
      if (!['PENDING_APPROVAL', 'PENDING_SETTLEMENT'].includes(appRow.rows[0].status as string)) {
        throw Object.assign(new Error(`Cannot approve from status: ${appRow.rows[0].status}`), { status: 409 });
      }

      // Get the current PENDING step (any stage — RINGI or SETTLEMENT)
      const currentStepRes = await client.query(
        `SELECT id, step_order, approver_id, stage FROM approval_steps
         WHERE application_id = $1 AND status = 'PENDING'
         ORDER BY step_order ASC LIMIT 1`,
        [id],
      );
      if (currentStepRes.rows.length === 0) {
        throw Object.assign(new Error('No pending approval step found — data inconsistency'), { status: 409 });
      }
      const currentStep = currentStepRes.rows[0] as {
        id: string; step_order: number; approver_id: string | null; stage: string;
      };

      // ── Authorization checks ──────────────────────────────────────────────

      // 1. If step has explicit approver and it's not the current user → reject
      if (role !== 'ADMIN' && currentStep.approver_id && currentStep.approver_id !== userId) {
        throw Object.assign(
          new Error('この承認ステップはあなたに割り当てられていません。別の承認者が担当しています。'),
          { status: 403 },
        );
      }

      // 2. For unassigned steps: prevent the SAME user from approving consecutive steps
      //    (stops one person from self-approving the entire chain)
      if (role !== 'ADMIN' && !currentStep.approver_id) {
        const prevActorRes = await client.query(
          `SELECT acted_by FROM approval_steps
           WHERE application_id = $1 AND stage = 'RINGI' AND status = 'APPROVED'
           ORDER BY step_order DESC LIMIT 1`,
          [id],
        );
        if (prevActorRes.rows.length > 0 && prevActorRes.rows[0].acted_by === userId) {
          throw Object.assign(
            new Error('直前のステップを承認した方は、次のステップを承認できません。別の承認者が必要です。'),
            { status: 403 },
          );
        }
      }

      // Mark current step approved + record who acted
      await client.query(
        `UPDATE approval_steps
         SET status = 'APPROVED', comment = $2, acted_at = CURRENT_TIMESTAMP, acted_by = $3
         WHERE id = $1`,
        [currentStep.id, comment ?? null, userId],
      );

      const nextStepRes = await client.query(
        `SELECT id, step_order FROM approval_steps
         WHERE application_id = $1 AND stage = $2 AND status = 'WAITING'
         ORDER BY step_order ASC LIMIT 1`,
        [id, currentStep.stage],
      );

      let updatedApp: Record<string, unknown>;

      if (nextStepRes.rows.length > 0) {
        // More steps remain → advance to next
        const nextStep = nextStepRes.rows[0] as { id: string; step_order: number };
        await client.query(`UPDATE approval_steps SET status = 'PENDING' WHERE id = $1`, [nextStep.id]);
        const appRes = await client.query(
          `SELECT id, status, application_number FROM applications WHERE id = $1`, [id],
        );
        updatedApp = { ...appRes.rows[0], advanced_to_step: nextStep.step_order };
      } else {
        // Final step for this stage
        const seqRow = await client.query(`SELECT nextval('application_number_seq') AS n`);
        const year = new Date().getFullYear();
        const appNumber = `RNG-${year}-${String(seqRow.rows[0].n).padStart(6, '0')}`;

        // RINGI final → APPROVED
        // SETTLEMENT final → SETTLEMENT_APPROVED (accounting must close with date+proof separately)
        const newStatus = currentStep.stage === 'SETTLEMENT' ? 'SETTLEMENT_APPROVED' : 'APPROVED';
        const appRes = await client.query(
          `UPDATE applications
           SET status = $2,
               application_number = COALESCE(application_number, $3)
           WHERE id = $1
           RETURNING id, status, application_number`,
          [id, newStatus, appNumber],
        );
        updatedApp = appRes.rows[0];
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_APPROVE', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ step: currentStep.step_order, actor: userId, comment: comment ?? null })],
      );

      return updatedApp;
    });

    const status = (result as { status?: string }).status;
    // APPROVED = ringi final; SETTLEMENT_APPROVED = settlement workflow final (accounting closes separately)
    const isFinal = status === 'APPROVED' || status === 'COMPLETED' || status === 'SETTLEMENT_APPROVED';
    const isSettlementApproved = status === 'SETTLEMENT_APPROVED';
    const isCompleted = status === 'COMPLETED';

    // Push real-time update to all connected clients
    emitAll('APPROVAL_ACTION', { type: 'approve', applicationId: id, final: isFinal });

    res.json({
      message: isSettlementApproved
        ? '精算承認完了 — 経理担当者が振込確認後に締めます'
        : isCompleted
          ? '精算完了 — 申請が完了しました'
          : isFinal
            ? '最終承認しました — 申請番号を発行しました'
            : '承認しました — 次の承認者に送付しました',
      application: result,
      final: isFinal,
      completed: isCompleted,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[approvals] approve failed:', err);
    res.status(500).json({ error: '承認処理に失敗しました' });
  }
});

// POST /approvals/:id/return
router.post('/:id/return', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };
  const { id: userId, role } = req.user!;
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      // ── Authorization: only assigned approver / role-gated MANAGER+ on
      //    unassigned step / ADMIN. Locks app row + verifies status.
      const currentStep = await assertCanActOnStep(
        client,
        { id: userId, role },
        String(id),
        ['PENDING_APPROVAL', 'PENDING_SETTLEMENT'],
      );
      const pendingStage = currentStep.stage;

      await client.query(
        `UPDATE applications SET status = 'RETURNED' WHERE id = $1`,
        [id],
      );

      // Mark the pending step as RETURNED (with comment)
      await client.query(
        `UPDATE approval_steps
         SET status = 'RETURNED', comment = $2, acted_at = CURRENT_TIMESTAMP, acted_by = $3
         WHERE id = $1`,
        [currentStep.id, comment ?? null, userId],
      );

      // Cancel any downstream WAITING steps in the same stage — they are dead branches now.
      // This prevents stale WAITING rows from polluting the next round's step chain.
      await client.query(
        `UPDATE approval_steps SET status = 'CANCELLED'
         WHERE application_id = $1 AND stage = $2 AND status = 'WAITING'`,
        [id, pendingStage],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_RETURN', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ actor: userId, comment: comment ?? null })],
      );
    });
    emitAll('APPROVAL_ACTION', { type: 'return', applicationId: id });
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
  const { id: userId, role } = req.user!;
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      // ── Authorization: only assigned approver / role-gated / ADMIN
      const currentStep = await assertCanActOnStep(
        client,
        { id: userId, role },
        String(id),
        ['PENDING_APPROVAL', 'PENDING_SETTLEMENT'],
      );

      await client.query(
        `UPDATE applications SET status = 'REJECTED' WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE approval_steps
         SET status = 'REJECTED', comment = $2, acted_at = CURRENT_TIMESTAMP, acted_by = $3
         WHERE id = $1`,
        [currentStep.id, comment ?? null, userId],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_REJECT', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ actor: userId, comment: comment ?? null })],
      );
    });
    emitAll('APPROVAL_ACTION', { type: 'reject', applicationId: id });
    res.json({ message: '却下しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[approvals] reject failed:', err);
    res.status(500).json({ error: '却下処理に失敗しました' });
  }
});

// GET /approvals/history — all steps this user has acted on (approved/rejected/returned)
router.get('/history', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { stage, status, template_id, date_from, date_to, applicant } = req.query as Record<string, string>;

  // acted_by = who actually clicked approve — only source of truth
  // No approver_id fallback: assigned ≠ acted; showing unverified attribution would leak other users' approvals
  const conditions: string[] = [
    "s.acted_by = $1",
    "s.status IN ('APPROVED', 'REJECTED', 'RETURNED')",
  ];
  const params: unknown[] = [userId];
  let idx = 2;

  if (stage && stage !== 'ALL') {
    conditions.push(`s.stage = $${idx++}`);
    params.push(stage);
  }
  if (status && status !== 'ALL') {
    conditions.push(`s.status = $${idx++}`);
    params.push(status);
  }
  if (template_id && template_id !== 'ALL') {
    conditions.push(`a.template_id = $${idx++}`);
    params.push(template_id);
  }
  if (date_from) {
    conditions.push(`s.acted_at >= $${idx++}`);
    params.push(date_from);
  }
  if (date_to) {
    conditions.push(`s.acted_at < ($${idx++}::date + INTERVAL '1 day')`);
    params.push(date_to);
  }
  if (applicant) {
    conditions.push(`u_app.full_name ILIKE $${idx++}`);
    params.push(`%${applicant}%`);
  }

  const limit  = Math.min(Number(req.query.limit  ?? APPROVAL_PAGE_SIZE), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  params.push(limit + 1);
  const limitIdx = idx++;
  params.push(offset);
  const offsetIdx = idx++;

  try {
    const sql = `
      SELECT
        s.id AS step_id,
        s.application_id,
        a.application_number,
        t.title_ja AS template_name,
        t.id AS template_id,
        s.stage,
        s.label AS step_label,
        s.action_type,
        s.status AS action,
        s.comment,
        s.acted_at,
        u_app.full_name AS applicant_name,
        u_app.avatar_url AS applicant_avatar,
        a.status AS app_status
      FROM approval_steps s
      JOIN applications a ON s.application_id = a.id
      JOIN form_templates t ON a.template_id = t.id
      LEFT JOIN users u_app ON a.applicant_id = u_app.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.acted_at DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const result = await query(sql, params);
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({ items: rows, hasMore, offset });
  } catch (err) {
    console.error('[approvals] history failed:', err);
    res.status(500).json({ error: `承認履歴の取得に失敗しました: ${(err as Error).message}` });
  }
});

export default router;
