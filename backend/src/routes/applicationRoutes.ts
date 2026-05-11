import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { assertCanReadApp, assertValidRouteForTemplate } from '../middlewares/authz';
import { mutationLimiter } from '../middlewares/rateLimit';
import { resolveApprovalSteps } from '../services/approvalStepService';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
// Per-IP cap of 300 req/min — protects DB from runaway clients
router.use(mutationLimiter);

// GET /applications/route-preview?template_id=X&stage=RINGI|SETTLEMENT
router.get('/route-preview', async (req: Request, res: Response): Promise<void> => {
  const { template_id, stage = 'RINGI' } = req.query as { template_id?: string; stage?: string };
  const department_id = req.user!.department_id;

  if (!template_id) { res.status(400).json({ error: 'template_id required' }); return; }
  if (!department_id) { res.status(422).json({ error: '部署が設定されていません。管理者にお問い合わせください。' }); return; }

  const routeStage = stage === 'SETTLEMENT' ? 'SETTLEMENT' : 'RINGI';

  try {
    const routes = await query(
      `SELECT r.id, r.name, r.is_default
       FROM approval_routes r
       WHERE r.template_id = $1
         AND r.department_id = $2
         AND r.stage = $3
         AND r.is_active = TRUE
       ORDER BY r.is_default DESC, r.name ASC`,
      [template_id, department_id, routeStage],
    );

    if (routes.rows.length === 0) {
      res.json({ routes: [], department_has_route: false }); return;
    }

    const steps = await query(
      `SELECT s.route_id, s.step_order, s.label, s.action_type,
              u.full_name AS approver_name, u.role AS approver_role
       FROM approval_route_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.route_id = ANY($1::uuid[])
       ORDER BY s.route_id, s.step_order`,
      [routes.rows.map((r: { id: string }) => r.id)],
    );

    const stepsByRoute = steps.rows.reduce<Record<string, unknown[]>>((acc, s) => {
      const key = (s as { route_id: string }).route_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    }, {});

    const result = routes.rows.map((r: { id: string }) => ({
      ...r,
      steps: stepsByRoute[r.id] || [],
    }));

    res.json({ routes: result, department_has_route: true });
  } catch (err) {
    console.error('[applications] route-preview failed:', err);
    res.status(500).json({ error: 'ルートの取得に失敗しました' });
  }
});

// POST /applications/draft — save a draft (no approval steps, no route required)
router.post('/draft', async (req: Request, res: Response): Promise<void> => {
  const { template_id, form_data } = req.body as {
    template_id: string;
    form_data: Record<string, unknown>;
  };
  try {
    const applicant_id = req.user!.id;
    const result = await query(
      `INSERT INTO applications (applicant_id, template_id, form_data, status)
       VALUES ($1, $2, $3::jsonb, 'DRAFT')
       RETURNING id, status`,
      [applicant_id, template_id, JSON.stringify(form_data)],
    );
    res.status(201).json({ message: '下書きを保存しました', application: result.rows[0], draft: true });
  } catch (err) {
    console.error('[applications] draft save failed:', err);
    res.status(500).json({ error: '下書きの保存に失敗しました' });
  }
});

// PATCH /applications/:id — update form_data for DRAFT or RETURNED applications
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { form_data } = req.body as { form_data: Record<string, unknown> };
  const applicant_id = req.user!.id;
  try {
    const result = await query(
      `UPDATE applications
       SET form_data = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND applicant_id = $3 AND status IN ('DRAFT', 'RETURNED')
       RETURNING id, status`,
      [JSON.stringify(form_data), req.params.id, applicant_id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: '申請が見つかりません（または編集権限がありません）' }); return;
    }
    res.json({ message: '申請を更新しました', application: result.rows[0] });
  } catch (err) {
    console.error('[applications] update failed:', err);
    res.status(500).json({ error: '申請の更新に失敗しました' });
  }
});

// POST /applications/:id/resubmit — RETURNED → PENDING_APPROVAL (fresh approval steps)
router.post('/:id/resubmit', async (req: Request, res: Response): Promise<void> => {
  const { form_data, route_id: chosen_route_id } = req.body as {
    form_data?: Record<string, unknown>;
    route_id?: string;
  };
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock RETURNED application owned by applicant
      const appRes = await client.query(
        `SELECT id, template_id, route_id FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'RETURNED' FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('差し戻し済み申請が見つかりません'), { status: 404 });
      }
      const { template_id, route_id: prev_route_id } = appRes.rows[0] as {
        template_id: string;
        route_id: string | null;
      };

      // Resolve route (prefer caller-supplied, then previous, then default)
      let route_id: string = chosen_route_id || prev_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = 'RINGI'
             AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(new Error('承認ルートが設定されていません'), { status: 422 });
        }
        route_id = routeRes.rows[0].id as string;
      } else if (chosen_route_id) {
        // Caller-supplied route — must match template+dept+stage+active
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, 'RINGI');
      }

      // Resolve route → concrete steps (single batched role lookup)
      const resolvedSteps = await resolveApprovalSteps(client, route_id);

      // Determine step_order offset (100 per round, so history is preserved in order)
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(step_order), 0) AS max_ord
         FROM approval_steps WHERE application_id = $1 AND stage = 'RINGI'`,
        [req.params.id],
      );
      const maxOrd = Number((maxRes.rows[0] as { max_ord: number }).max_ord);
      const offset = Math.ceil((maxOrd + 1) / 100) * 100; // next hundred boundary: 100, 200, …

      // Remove dead-branch steps (PENDING/WAITING/CANCELLED — no history value).
      // RETURNED steps are kept as audit history.
      await client.query(
        `DELETE FROM approval_steps
         WHERE application_id = $1 AND stage = 'RINGI' AND status IN ('PENDING', 'WAITING', 'CANCELLED')`,
        [req.params.id],
      );

      // Update application (optionally save updated form_data)
      if (form_data) {
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_APPROVAL', route_id = $1,
               submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
               form_data = $2::jsonb
           WHERE id = $3`,
          [route_id, JSON.stringify(form_data), req.params.id],
        );
      } else {
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_APPROVAL', route_id = $1,
               submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [route_id, req.params.id],
        );
      }

      // Insert fresh RINGI steps with offset step_orders
      for (let i = 0; i < resolvedSteps.length; i++) {
        const s = resolvedSteps[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'RINGI', $3, $4, $5, $6)`,
          [req.params.id, offset + s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('RESUBMIT', 'application', $1, $2::jsonb)`,
        [req.params.id, JSON.stringify({ route_id, offset, steps: resolvedSteps.length })],
      );

      const appId = String(req.params.id);
      const recipients = await computeApplicationRecipients(client, appId);
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          appId,
        recipient_user_ids: recipients,
        payload:            { type: 'resubmit', applicationId: appId },
      });

      return { id: req.params.id, status: 'PENDING_APPROVAL', round_offset: offset };
    });

    res.json({ message: '再提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] resubmit failed:', err);
    res.status(500).json({ error: '再提出に失敗しました' });
  }
});

// POST /applications/:id/submit — convert DRAFT → PENDING_APPROVAL with approval steps
router.post('/:id/submit', async (req: Request, res: Response): Promise<void> => {
  const { route_id: chosen_route_id } = req.body as { route_id?: string };
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません。管理者にお問い合わせください。' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Load and lock the draft
      const draftRes = await client.query(
        `SELECT id, status, template_id FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT' FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (draftRes.rows.length === 0) {
        throw Object.assign(new Error('下書きが見つかりません'), { status: 404 });
      }
      const { template_id } = draftRes.rows[0] as { template_id: string; id: string; status: string };

      // Resolve route
      let route_id: string = chosen_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = 'RINGI' AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) throw Object.assign(new Error('承認ルートが設定されていません'), { status: 422 });
        route_id = routeRes.rows[0].id as string;
      } else {
        // Client-supplied route — must match template+dept+stage+active
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, 'RINGI');
      }

      // Resolve route → concrete steps (single batched role lookup)
      const resolvedSubmitSteps = await resolveApprovalSteps(client, route_id);

      // Update application to PENDING_APPROVAL
      await client.query(
        `UPDATE applications SET status = 'PENDING_APPROVAL', route_id = $2, submitted_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, route_id],
      );

      // Create approval steps
      for (let i = 0; i < resolvedSubmitSteps.length; i++) {
        const s = resolvedSubmitSteps[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'RINGI', $3, $4, $5, $6)`,
          [req.params.id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('DRAFT_SUBMIT', 'application', $1)`,
        [req.params.id],
      );

      const appId = String(req.params.id);
      const recipients = await computeApplicationRecipients(client, appId);
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          appId,
        recipient_user_ids: recipients,
        payload:            { type: 'submit', applicationId: appId },
      });

      return { id: req.params.id, status: 'PENDING_APPROVAL', total_steps: resolvedSubmitSteps.length };
    });
    res.json({ message: '申請を提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] draft submit failed:', err);
    res.status(500).json({ error: '申請の提出に失敗しました' });
  }
});

// POST /applications/:id/start-settlement — APPROVED app → PENDING_SETTLEMENT
router.post('/:id/start-settlement', async (req: Request, res: Response): Promise<void> => {
  const { settlement_data, route_id: chosen_route_id } = req.body as {
    settlement_data: Record<string, unknown>;
    route_id?: string;
  };
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Load and lock — must be APPROVED and owned by applicant
      const appRes = await client.query(
        `SELECT a.id, a.template_id, a.form_data
         FROM applications a
         WHERE a.id = $1 AND a.applicant_id = $2 AND a.status = 'APPROVED'
         FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('対象の申請が見つかりません（申請者本人かつ承認済みのみ精算可能）'), { status: 404 });
      }
      const { template_id, form_data: originalFormData } = appRes.rows[0] as { template_id: string; form_data: Record<string, unknown> };

      // Confirm template has settlement_schema
      const tmplRes = await client.query(
        `SELECT id FROM form_templates WHERE id = $1 AND settlement_schema IS NOT NULL`,
        [template_id],
      );
      if (tmplRes.rows.length === 0) {
        throw Object.assign(new Error('このテンプレートは精算に対応していません'), { status: 422 });
      }

      // Resolve SETTLEMENT route
      let route_id: string = chosen_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = 'SETTLEMENT'
             AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(
            new Error('精算承認ルートが設定されていません。管理者にお問い合わせください。'),
            { status: 422 },
          );
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        // Caller-supplied route — must match template+dept+SETTLEMENT+active
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, 'SETTLEMENT');
      }

      // Resolve settlement route → concrete steps (single batched role lookup)
      const resolvedSteps = await resolveApprovalSteps(client, route_id, '精算ルート');

      // Update application
      await client.query(
        `UPDATE applications
         SET settlement_data = $2::jsonb, status = 'PENDING_SETTLEMENT',
             settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, JSON.stringify(settlement_data)],
      );

      // Create / update settlements table row for accounting dashboard
      const expectedAmount = parseFloat(String(originalFormData?.expected_amount ?? 0)) || 0;
      // actual_amount may be computed from line_items; fall back to direct field
      const rawActual = settlement_data?.actual_amount;
      const actualAmount = typeof rawActual === 'number' ? rawActual : parseFloat(String(rawActual ?? 0)) || 0;
      await client.query(
        `INSERT INTO settlements (application_id, expected_amount, actual_amount, settlement_data, status)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING_VERIFICATION')
         ON CONFLICT (application_id) DO UPDATE SET
           actual_amount    = EXCLUDED.actual_amount,
           settlement_data  = EXCLUDED.settlement_data,
           updated_at       = CURRENT_TIMESTAMP`,
        [req.params.id, expectedAmount, actualAmount, JSON.stringify(settlement_data)],
      );

      // Clear any stale settlement steps (idempotent — safe to resubmit settlement)
      await client.query(
        `DELETE FROM approval_steps
         WHERE application_id = $1 AND stage = 'SETTLEMENT' AND status IN ('PENDING', 'WAITING', 'CANCELLED')`,
        [req.params.id],
      );

      // Create SETTLEMENT approval steps
      for (let i = 0; i < resolvedSteps.length; i++) {
        const s = resolvedSteps[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'SETTLEMENT', $3, $4, $5, $6)`,
          [req.params.id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id)
         VALUES ('SETTLEMENT_START', 'application', $1)`,
        [req.params.id],
      );

      const appId = String(req.params.id);
      const recipients = await computeApplicationRecipients(client, appId, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          appId,
        recipient_user_ids: recipients,
        payload:            { type: 'settlement_start', applicationId: appId },
      });

      return { id: req.params.id, status: 'PENDING_SETTLEMENT', total_settlement_steps: resolvedSteps.length };
    });

    res.json({ message: '精算申請を提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] start-settlement failed:', err);
    res.status(500).json({ error: '精算申請の提出に失敗しました' });
  }
});

// POST /applications/:id/resubmit-settlement — RETURNED (settlement phase) → PENDING_SETTLEMENT
// Mirrors resubmit but for settlement round: keeps RINGI history, restarts settlement steps only.
router.post('/:id/resubmit-settlement', async (req: Request, res: Response): Promise<void> => {
  const { settlement_data, route_id: chosen_route_id } = req.body as {
    settlement_data: Record<string, unknown>;
    route_id?: string;
  };
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock app — must be RETURNED with a settlement step that was returned
      const appRes = await client.query(
        `SELECT a.id, a.template_id, a.route_id
         FROM applications a
         WHERE a.id = $1 AND a.applicant_id = $2 AND a.status = 'RETURNED'
         FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('差し戻し済み申請が見つかりません'), { status: 404 });
      }

      // Confirm the returned step is from SETTLEMENT phase
      const returnedSettleStep = await client.query(
        `SELECT id FROM approval_steps
         WHERE application_id = $1 AND stage = 'SETTLEMENT' AND status = 'RETURNED'
         LIMIT 1`,
        [req.params.id],
      );
      if (returnedSettleStep.rows.length === 0) {
        throw Object.assign(new Error('精算フェーズの差し戻しステップが見つかりません'), { status: 409 });
      }

      const { template_id } = appRes.rows[0] as { template_id: string; route_id: string | null };

      // Resolve SETTLEMENT route
      let route_id: string = chosen_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = 'SETTLEMENT'
             AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(new Error('精算承認ルートが設定されていません'), { status: 422 });
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        // Caller-supplied — validate scope
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, 'SETTLEMENT');
      }

      // Resolve SETTLEMENT route → concrete steps (single batched role lookup)
      const resolvedSteps = await resolveApprovalSteps(client, route_id, '精算ルート');

      // Determine round offset for settlement (same logic as RINGI resubmit — preserves history)
      const maxSettleRes = await client.query(
        `SELECT COALESCE(MAX(step_order), 0) AS max_ord
         FROM approval_steps WHERE application_id = $1 AND stage = 'SETTLEMENT'`,
        [req.params.id],
      );
      const maxSettleOrd = Number((maxSettleRes.rows[0] as { max_ord: number }).max_ord);
      const settleOffset = Math.ceil((maxSettleOrd + 1) / 100) * 100; // e.g. 100, 200, …

      // Remove dead-branch steps (PENDING/WAITING/CANCELLED).
      // RETURNED and APPROVED steps are kept as audit history.
      await client.query(
        `DELETE FROM approval_steps
         WHERE application_id = $1 AND stage = 'SETTLEMENT' AND status IN ('PENDING', 'WAITING', 'CANCELLED')`,
        [req.params.id],
      );

      // Update application status + settlement_data
      await client.query(
        `UPDATE applications
         SET status = 'PENDING_SETTLEMENT', settlement_data = $2::jsonb,
             settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, JSON.stringify(settlement_data)],
      );

      // Update settlements table row
      const rawActual = settlement_data?.actual_amount;
      const actualAmount = typeof rawActual === 'number' ? rawActual : parseFloat(String(rawActual ?? 0)) || 0;
      await client.query(
        `UPDATE settlements
         SET actual_amount = $2, settlement_data = $3::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE application_id = $1`,
        [req.params.id, actualAmount, JSON.stringify(settlement_data)],
      );

      // Insert fresh SETTLEMENT steps with round offset (avoids step_order collision with prior rounds)
      for (let i = 0; i < resolvedSteps.length; i++) {
        const s = resolvedSteps[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'SETTLEMENT', $3, $4, $5, $6)`,
          [req.params.id, settleOffset + s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id)
         VALUES ('SETTLEMENT_RESUBMIT', 'application', $1)`,
        [req.params.id],
      );

      const appId = String(req.params.id);
      const recipients = await computeApplicationRecipients(client, appId, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          appId,
        recipient_user_ids: recipients,
        payload:            { type: 'settlement_resubmit', applicationId: appId },
      });

      return { id: req.params.id, status: 'PENDING_SETTLEMENT' };
    });

    res.json({ message: '精算を再提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] resubmit-settlement failed:', err);
    res.status(500).json({ error: '精算の再提出に失敗しました' });
  }
});

// POST /applications — submit new ringi
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { template_id, stage, form_data, route_id: chosen_route_id } = req.body as {
    template_id: string;
    stage?: string;
    form_data: Record<string, unknown>;
    route_id?: string;
  };

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const applicant_id  = req.user!.id;
      const department_id = req.user!.department_id;

      if (!department_id) {
        const err = Object.assign(new Error('あなたの部署が設定されていません。管理者にお問い合わせください。'), { status: 422 });
        throw err;
      }

      let route_id: string = chosen_route_id || '';

      if (!route_id) {
        const routeRes = await client.query(
          `SELECT r.id FROM approval_routes r
           WHERE r.template_id = $1 AND r.department_id = $2
             AND r.stage = 'RINGI' AND r.is_active = TRUE AND r.is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(
            new Error('この部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。'),
            { status: 422 },
          );
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        const verify = await client.query(
          `SELECT id FROM approval_routes
           WHERE id = $1 AND template_id = $2 AND department_id = $3 AND is_active = TRUE`,
          [route_id, template_id, department_id],
        );
        if (verify.rows.length === 0) {
          throw Object.assign(
            new Error('選択したルートはこの部署・テンプレートに対して無効です。'),
            { status: 422 },
          );
        }
      }

      // Resolve route → concrete steps (single batched role lookup)
      const ringiResolvedSteps = await resolveApprovalSteps(client, route_id, '承認ルート');

      const appRes = await client.query(
        `INSERT INTO applications (applicant_id, template_id, route_id, form_data, status, submitted_at)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING_APPROVAL', CURRENT_TIMESTAMP)
         RETURNING id, status`,
        [applicant_id, template_id, route_id, JSON.stringify(form_data)],
      );
      const app = appRes.rows[0] as { id: string; status: string };

      for (let i = 0; i < ringiResolvedSteps.length; i++) {
        const s = ringiResolvedSteps[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'RINGI', $3, $4, $5, $6)`,
          [app.id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPLICATION_SUBMIT', 'application', $1, $2::jsonb)`,
        [app.id, JSON.stringify({ template_id, stage, steps: ringiResolvedSteps.length })],
      );

      return { ...app, total_steps: ringiResolvedSteps.length };
    });

    res.status(201).json({ message: '申請が完了しました！', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] submit failed:', err);
    res.status(500).json({ error: '申請の保存に失敗しました' });
  }
});

// GET /applications — applicant's own list  (paginated)
// ?limit=25&offset=0&status=DRAFT   (status omit or 'ALL' = no filter)
const APP_PAGE_SIZE = 25;
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit  = Math.min(Number(req.query.limit  ?? APP_PAGE_SIZE), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const status = ((req.query.status as string | undefined) ?? 'ALL').toUpperCase();

  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.created_at, a.submitted_at,
         a.settlement_submitted_at,
         t.title_ja AS template_name, t.code AS template_code,
         t.settlement_schema IS NOT NULL AS has_settlement,
         COALESCE(
           (SELECT s.step_order FROM approval_steps s
            WHERE s.application_id = a.id AND s.stage = 'SETTLEMENT' AND s.status = 'PENDING'
            LIMIT 1),
           (SELECT s.step_order FROM approval_steps s
            WHERE s.application_id = a.id AND s.stage = 'RINGI' AND s.status = 'PENDING'
            LIMIT 1)
         ) AS current_step,
         (SELECT COUNT(*) FROM approval_steps s
          WHERE s.application_id = a.id AND s.stage = 'RINGI') AS total_steps
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       WHERE a.applicant_id = $1
         AND ($2 = 'ALL' OR a.status = $2)
       ORDER BY a.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user!.id, status, limit + 1, offset],
    );
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({ items: rows, hasMore, offset });
  } catch (err) {
    console.error('[applications] list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

// GET /applications/:id — full detail + approval timeline
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Authorization: must be applicant, assigned approver, prior actor,
    //    same-dept manager+, ACCOUNTING, or ADMIN
    await assertCanReadApp({ id: req.user!.id, role: req.user!.role }, String(req.params.id));

    const appRes = await query(
      `SELECT a.id, a.application_number, a.status, a.form_data, a.version,
              a.settlement_data, a.settlement_submitted_at,
              a.template_id, a.created_at, a.submitted_at, a.completed_at,
              t.title_ja AS template_name, t.code AS template_code,
              t.schema_definition, t.settlement_schema,
              t.settlement_schema IS NOT NULL AS has_settlement,
              u.full_name AS applicant_name,
              u.avatar_url AS applicant_avatar,
              s.transfer_date, s.transfer_proof_url, s.accounting_note,
              s.expected_amount, s.actual_amount AS settled_actual_amount,
              s.processed_at AS settlement_processed_at,
              s.status AS settlement_status
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       LEFT JOIN settlements s ON s.application_id = a.id
       WHERE a.id = $1`,
      [req.params.id],
    );
    if (appRes.rows.length === 0) { res.status(404).json({ error: 'Application not found' }); return; }

    const stepsRes = await query(
      `SELECT s.step_order, s.stage, s.status, s.label, s.action_type,
              s.comment, s.acted_at, u.full_name AS approver_name
       FROM approval_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.application_id = $1
       ORDER BY s.stage, s.step_order`,
      [req.params.id],
    );

    res.json({ ...appRes.rows[0], steps: stepsRes.rows });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] detail failed:', err);
    res.status(500).json({ error: '申請詳細の取得に失敗しました' });
  }
});

// DELETE /applications/:id — delete own DRAFT only
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `DELETE FROM applications
       WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT'
       RETURNING id`,
      [req.params.id, req.user!.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: '下書きが見つかりません（または削除権限がありません）' }); return;
    }
    res.json({ message: '下書きを削除しました' });
  } catch (err) {
    console.error('[applications] draft delete failed:', err);
    res.status(500).json({ error: '下書きの削除に失敗しました' });
  }
});

export default router;
