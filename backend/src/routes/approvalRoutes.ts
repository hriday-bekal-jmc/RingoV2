import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';
import { assertCanActOnStep, httpErr } from '../middlewares/authz';
import { mutationLimiter } from '../middlewares/rateLimit';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { invalidateDashboardCache } from '../services/dashboardCache';
import { decodeCursor, encodeCursor, parsePageLimit } from '../services/pagination';
import { extractRowPreview } from '../services/rowPreview';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(mutationLimiter);

// GET /approvals/pending/count — just total, no rows. For sidebar badge.
// Sub-millisecond: single indexed COUNT on approval_steps.
router.get('/pending/count', async (req: Request, res: Response): Promise<void> => {
  const { id: userId } = req.user!;
  const systemView = isAdminUser(req.user) && req.query.all === 'true';
  try {
    const r = await query(
      systemView
        ? `SELECT COUNT(*)::int AS total
           FROM approval_steps s
           JOIN applications a ON a.id = s.application_id
           WHERE s.status = 'PENDING'
             AND a.status IN ('PENDING_APPROVAL','PENDING_SETTLEMENT')
             AND a.archived_at IS NULL`
        : `SELECT COUNT(*)::int AS total
           FROM approval_steps s
           JOIN applications a ON a.id = s.application_id
           WHERE s.status = 'PENDING'
             AND a.status IN ('PENDING_APPROVAL','PENDING_SETTLEMENT')
             AND a.archived_at IS NULL
             AND s.approver_id = $1`,
      systemView ? [] : [userId],
    );
    res.json({ total: r.rows[0]?.total ?? 0 });
  } catch (err) {
    console.error('[approvals] count failed:', err);
    res.status(500).json({ error: 'カウント取得に失敗しました' });
  }
});

// GET /approvals/pending — steps assigned to current user  (paginated)
// ?all=true (ADMIN only) → system-wide view
// ?limit=25&offset=0
const APPROVAL_PAGE_SIZE = 25;
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  const { id: userId } = req.user!;
  const systemView = isAdminUser(req.user) && req.query.all === 'true';
  const limit  = parsePageLimit(req.query.limit, APPROVAL_PAGE_SIZE, 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const cursor = decodeCursor(req.query.cursor);
  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.created_at,
         a.form_data, a.settlement_data, a.template_id,
         t.title_ja AS template_name,
         u.full_name AS applicant_name,
         u.avatar_url AS applicant_avatar,
         COALESCE(d.name, '—') AS department_name,
         s.id AS current_step_id,
         (SELECT COUNT(*) FROM approval_steps
          WHERE application_id = a.id AND stage = s.stage
            AND step_order / 100 = s.step_order / 100
            AND step_order <= s.step_order)::int AS current_step,
         s.stage AS current_stage,
         s.label AS current_step_label,
         s.action_type AS current_step_action,
         approver.full_name AS current_approver_name,
         approver.avatar_url AS current_approver_avatar,
         (SELECT COUNT(*) FROM approval_steps
          WHERE application_id = a.id AND stage = s.stage
            AND step_order / 100 = s.step_order / 100)::int AS total_steps,
         COUNT(*) OVER() AS total_count
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       LEFT JOIN departments d ON d.id = u.department_id
       JOIN approval_steps s
         ON s.application_id = a.id AND s.status = 'PENDING'
       LEFT JOIN users approver ON s.approver_id = approver.id
       WHERE a.status IN ('PENDING_APPROVAL', 'PENDING_SETTLEMENT')
         AND a.archived_at IS NULL
         AND ($1 OR s.approver_id = $2)
         AND (
           $3::timestamptz IS NULL
           OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid)
         )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5 OFFSET $6`,
      [systemView, userId, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1, cursor ? 0 : offset],
    );
    const rows    = result.rows;
    const total   = Number(rows[0]?.total_count ?? 0);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    // Batch-load active schemas for unique templates in this page
    const templateIds = [...new Set(rows.map((r: any) => r.template_id as string))];
    const schemaMap = new Map<string, { schema_definition: any; settlement_schema: any }>();
    if (templateIds.length > 0) {
      const sr = await query(
        `SELECT template_id, schema_definition, settlement_schema
         FROM form_template_versions
         WHERE is_active = TRUE AND template_id = ANY($1::uuid[])`,
        [templateIds],
      );
      for (const s of sr.rows) {
        schemaMap.set(s.template_id as string, {
          schema_definition: s.schema_definition,
          settlement_schema: s.settlement_schema,
        });
      }
    }

    // Build items: extract row_preview, strip raw blobs and internal fields
    const items = rows.map((r: any) => {
      const schemas = schemaMap.get(r.template_id);
      const row_preview = extractRowPreview(
        schemas?.schema_definition,
        r.form_data,
        schemas?.settlement_schema,
        r.settlement_data,
      );
      const { form_data: _fd, settlement_data: _sd, template_id: _tid, total_count: _, ...rest } = r;
      return { ...rest, row_preview };
    });

    res.json({
      items,
      hasMore,
      total,
      offset,
      nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    });
  } catch (err) {
    console.error('[approvals] pending fetch failed:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

// POST /approvals/:id/approve
router.post('/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = (req.body ?? {}) as { comment?: string };
  const { id: userId } = req.user!;
  const isAdmin = isAdminUser(req.user);

  let approveRecipients: string[] = [];
  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock the application row (include applicant_id for cache invalidation)
      const appRow = await client.query(
        `SELECT id, status, application_number, route_id, applicant_id FROM applications WHERE id = $1 FOR UPDATE`,
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
      if (!isAdmin && currentStep.approver_id && currentStep.approver_id !== userId) {
        throw Object.assign(
          new Error('この承認ステップはあなたに割り当てられていません。別の承認者が担当しています。'),
          { status: 403 },
        );
      }

      // 2. For unassigned steps: prevent the SAME user from approving consecutive steps
      //    (stops one person from self-approving the entire chain)
      if (!isAdmin && !currentStep.approver_id) {
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
        // Final step for this stage — assign app number using per-template per-year sequence
        const year = new Date().getFullYear();
        const tmplRes = await client.query(
          `SELECT ft.app_number_prefix, ft.app_number_digits
           FROM applications a
           JOIN form_templates ft ON ft.id = a.template_id
           WHERE a.id = $1`,
          [id],
        );
        const prefix: string = tmplRes.rows[0]?.app_number_prefix ?? 'RNG';
        const digits: number = tmplRes.rows[0]?.app_number_digits  ?? 6;
        const seqRes = await client.query(
          `INSERT INTO application_number_sequences (template_id, year, prefix, last_seq)
           SELECT a.template_id, $2, $3, 1
           FROM applications a WHERE a.id = $1
           ON CONFLICT (template_id, year, prefix) DO UPDATE
             SET last_seq = application_number_sequences.last_seq + 1
           RETURNING last_seq`,
          [id, year, prefix],
        );
        const appNumber = `${prefix}-${year}-${String(seqRes.rows[0].last_seq).padStart(digits, '0')}`;

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

      // Targeted SSE event via outbox — atomic with business change.
      // include accounting users for settlement-stage transitions so their
      // dashboards refresh immediately.
      const isSettlementStage = currentStep.stage === 'SETTLEMENT';
      const appId = String(id);
      const recipients = await computeApplicationRecipients(client, appId, {
        includeAccounting: isSettlementStage,
      });
      const isFinalForOutbox =
        ((updatedApp as { status?: string }).status === 'APPROVED') ||
        ((updatedApp as { status?: string }).status === 'COMPLETED') ||
        ((updatedApp as { status?: string }).status === 'SETTLEMENT_APPROVED');
      await insertOutboxEvent(client, {
        event_type:         'APPROVAL_ACTION',
        entity_type:        'application',
        entity_id:          appId,
        recipient_user_ids: recipients,
        payload:            { type: 'approve', applicationId: appId, final: isFinalForOutbox },
      });

      approveRecipients = recipients;
      return updatedApp;
    });

    // Bust Redis dashboard cache for all affected users — must happen AFTER tx commits
    // so the next refetch hits the DB and gets fresh data.
    invalidateDashboardCache(approveRecipients);

    const status = (result as { status?: string }).status;
    // APPROVED = ringi final; SETTLEMENT_APPROVED = settlement workflow final (accounting closes separately)
    const isFinal = status === 'APPROVED' || status === 'COMPLETED' || status === 'SETTLEMENT_APPROVED';
    const isSettlementApproved = status === 'SETTLEMENT_APPROVED';
    const isCompleted = status === 'COMPLETED';

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
  let returnRecipients: string[] = [];
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      // ── Authorization: only assigned approver / role-gated MANAGER+ on
      //    unassigned step / ADMIN. Locks app row + verifies status.
      const currentStep = await assertCanActOnStep(
        client,
        { id: userId, role, is_admin: req.user!.is_admin },
        String(id),
        ['PENDING_APPROVAL', 'PENDING_SETTLEMENT'],
      );

      // CONFIRM steps are acknowledgment-only — return/reject not permitted.
      if (currentStep.action_type === 'CONFIRM') {
        throw httpErr(403, 'このステップは確認のみです。差し戻しはできません。');
      }

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

      const recipients = await computeApplicationRecipients(client, String(id), {
        includeAccounting: pendingStage === 'SETTLEMENT',
      });
      await insertOutboxEvent(client, {
        event_type:         'APPROVAL_ACTION',
        entity_type:        'application',
        entity_id:          String(id),
        recipient_user_ids: recipients,
        payload:            { type: 'return', applicationId: id },
      });
      returnRecipients = recipients;
    });
    invalidateDashboardCache(returnRecipients);
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
  let rejectRecipients: string[] = [];
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      // ── Authorization: only assigned approver / role-gated / ADMIN
      const currentStep = await assertCanActOnStep(
        client,
        { id: userId, role, is_admin: req.user!.is_admin },
        String(id),
        ['PENDING_APPROVAL', 'PENDING_SETTLEMENT'],
      );

      // CONFIRM steps are acknowledgment-only — reject not permitted.
      if (currentStep.action_type === 'CONFIRM') {
        throw httpErr(403, 'このステップは確認のみです。却下はできません。');
      }

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

      const recipients = await computeApplicationRecipients(client, String(id), {
        includeAccounting: currentStep.stage === 'SETTLEMENT',
      });
      await insertOutboxEvent(client, {
        event_type:         'APPROVAL_ACTION',
        entity_type:        'application',
        entity_id:          String(id),
        recipient_user_ids: recipients,
        payload:            { type: 'reject', applicationId: id },
      });
      rejectRecipients = recipients;
    });
    invalidateDashboardCache(rejectRecipients);
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
  const cursor = decodeCursor(req.query.cursor);

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
  if (cursor) {
    conditions.push(`(s.acted_at, s.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
    params.push(cursor.created_at, cursor.id);
  }

  const limit  = parsePageLimit(req.query.limit, APPROVAL_PAGE_SIZE, 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  params.push(limit + 1);
  const limitIdx = idx++;
  params.push(cursor ? 0 : offset);
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
      ORDER BY s.acted_at DESC NULLS LAST, s.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const result = await query(sql, params);
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({
      items: rows,
      hasMore,
      offset,
      nextCursor: hasMore
        ? encodeCursor({ created_at: rows[rows.length - 1].acted_at, id: rows[rows.length - 1].step_id })
        : null,
    });
  } catch (err) {
    console.error('[approvals] history failed:', err);
    res.status(500).json({ error: `承認履歴の取得に失敗しました: ${(err as Error).message}` });
  }
});

export default router;
