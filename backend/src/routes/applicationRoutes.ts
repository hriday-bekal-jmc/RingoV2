import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { assertCanReadApp, assertValidRouteForTemplate } from '../middlewares/authz';
import { mutationLimiter } from '../middlewares/rateLimit';
import { resolveApprovalSteps, skipStepsThroughApplicant, type ResolvedStep } from '../services/approvalStepService';
import { applyComputedFormData, validateFormData } from '../services/formValidation';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { invalidateDashboardCache } from '../services/dashboardCache';
import { decodeCursor, encodeCursor, parsePageLimit } from '../services/pagination';
import { extractRowPreview } from '../services/rowPreview';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
// Per-IP cap of 300 req/min — protects DB from runaway clients
router.use(mutationLimiter);

type ApprovalStage = 'RINGI' | 'SETTLEMENT';

// Resolve the headline amount for a settlement-only (pattern_id=2) application.
// Used to populate settlements.expected_amount so accounting page sees the total.
//
// Detection order (first hit wins):
//   1. Explicit `grand_total` (transportation form convention)
//   2. Any schema field with `computed: true` (sum_target receiver)
//   3. Any schema field with `sum_target` defined (rolled-up source totals)
//   4. First number-type field in schema
// Returns 0 when nothing matches (rare — admin-built form w/o numbers).
interface AmountField { name: string; type: string; computed?: boolean; sum_target?: string }
function detectSettlementAmount(
  schema:   { fields?: AmountField[] } | null | undefined,
  formData: Record<string, unknown>,
): number {
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
    return isFinite(n) ? n : 0;
  };
  if (formData.grand_total != null) return num(formData.grand_total);
  const fields = schema?.fields ?? [];
  const computed = fields.find((f) => f.computed && f.type === 'number');
  if (computed) return num(formData[computed.name]);
  const firstWithSumTarget = fields.find((f) => !!f.sum_target);
  if (firstWithSumTarget && firstWithSumTarget.sum_target) {
    return num(formData[firstWithSumTarget.sum_target]);
  }
  const firstNumber = fields.find((f) => f.type === 'number');
  if (firstNumber) return num(formData[firstNumber.name]);
  return 0;
}

async function nextApplicationNumber(client: pg.PoolClient, appId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Look up template's prefix and digit padding
  const tmplRes = await client.query(
    `SELECT ft.app_number_prefix, ft.app_number_digits
     FROM applications a
     JOIN form_templates ft ON ft.id = a.template_id
     WHERE a.id = $1`,
    [appId],
  );
  const prefix: string  = tmplRes.rows[0]?.app_number_prefix ?? 'RNG';
  const digits: number  = tmplRes.rows[0]?.app_number_digits  ?? 6;

  // Atomic upsert keyed on (template_id, year, prefix).
  // Prefix change → new PK row → counter starts at 1. Old apps unaffected via COALESCE.
  const seqRes = await client.query(
    `INSERT INTO application_number_sequences (template_id, year, prefix, last_seq)
     SELECT a.template_id, $2, $3, 1
     FROM applications a WHERE a.id = $1
     ON CONFLICT (template_id, year, prefix) DO UPDATE
       SET last_seq = application_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [appId, year, prefix],
  );
  const seq: number = seqRes.rows[0].last_seq;
  return `${prefix}-${year}-${String(seq).padStart(digits, '0')}`;
}

// Assign application_number on DRAFT exit if not already set.
// Caller must hold a row lock (FOR UPDATE) on the application row to prevent
// concurrent assignment races. Returns the resulting number (existing or new).
async function ensureApplicationNumber(client: pg.PoolClient, appId: string): Promise<string> {
  const existing = await client.query(
    `SELECT application_number FROM applications WHERE id = $1`,
    [appId],
  );
  const current = existing.rows[0]?.application_number as string | null | undefined;
  if (current) return current;

  const appNumber = await nextApplicationNumber(client, appId);
  await client.query(
    `UPDATE applications
     SET application_number = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND application_number IS NULL`,
    [appNumber, appId],
  );
  return appNumber;
}

async function finalizeStageWithoutApprovalSteps(
  client: pg.PoolClient,
  appId: string,
  stage: ApprovalStage,
): Promise<{ id: string; status: string; application_number: string | null }> {
  const appNumber = await nextApplicationNumber(client, appId);
  const status = stage === 'SETTLEMENT' ? 'SETTLEMENT_APPROVED' : 'APPROVED';
  const appRes = await client.query(
    `UPDATE applications
     SET status = $2,
         application_number = COALESCE(application_number, $3),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, status, application_number`,
    [appId, status, appNumber],
  );
  return appRes.rows[0] as { id: string; status: string; application_number: string | null };
}

async function insertApprovalSteps(
  client: pg.PoolClient,
  appId: string,
  stage: ApprovalStage,
  steps: ResolvedStep[],
  offset = 0,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await client.query(
      `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [appId, offset + s.step_order, stage, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
    );
  }
}

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
      `SELECT s.route_id, s.step_order, s.approver_id, s.label, s.action_type,
              u.full_name AS approver_name, u.role AS approver_role,
              u.avatar_url AS approver_avatar
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

    const applicantId = req.user!.id;
    const result = routes.rows.map((r: { id: string }) => {
      const routeSteps = (stepsByRoute[r.id] || []) as Array<{ approver_id?: string | null }>;
      const ownStepIndex = routeSteps.findIndex((s) => s.approver_id === applicantId);
      return {
        ...r,
        steps: ownStepIndex >= 0 ? routeSteps.slice(ownStepIndex + 1) : routeSteps,
        skipped_steps: ownStepIndex >= 0 ? ownStepIndex + 1 : 0,
      };
    });

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
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Capture active version at draft creation — locks schema to what user is editing
      const verRes = await client.query(
        `SELECT id, schema_definition FROM form_template_versions WHERE template_id = $1 AND is_active = TRUE LIMIT 1`,
        [template_id],
      );
      const versionId = verRes.rows[0]?.id ?? null;
      const normalizedFormData = applyComputedFormData(verRes.rows[0]?.schema_definition, form_data);
      const appRes = await client.query(
        `INSERT INTO applications (applicant_id, template_id, template_version_id, form_data, status)
         VALUES ($1, $2, $3, $4::jsonb, 'DRAFT')
         RETURNING id, status`,
        [applicant_id, template_id, versionId, JSON.stringify(normalizedFormData)],
      );
      const app = appRes.rows[0] as { id: string; status: string };
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          app.id,
        recipient_user_ids: [applicant_id],
        payload:            { type: 'draft_create', applicationId: app.id },
      });
      return app;
    });
    res.status(201).json({ message: '下書きを保存しました', application: result, draft: true });
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
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const schemaRes = await client.query(
        `SELECT COALESCE(v.schema_definition, active_v.schema_definition) AS schema_definition
         FROM applications a
         LEFT JOIN form_template_versions v ON v.id = a.template_version_id
         LEFT JOIN LATERAL (
           SELECT schema_definition
           FROM form_template_versions
           WHERE template_id = a.template_id AND is_active = TRUE
           LIMIT 1
         ) active_v ON TRUE
         WHERE a.id = $1 AND a.applicant_id = $2 AND a.status IN ('DRAFT', 'RETURNED')`,
        [req.params.id, applicant_id],
      );
      const normalizedFormData = applyComputedFormData(schemaRes.rows[0]?.schema_definition, form_data);
      const appRes = await client.query(
        `UPDATE applications
         SET form_data = $1::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND applicant_id = $3 AND status IN ('DRAFT', 'RETURNED')
         RETURNING id, status`,
        [JSON.stringify(normalizedFormData), req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('申請が見つかりません（または編集権限がありません）'), { status: 404 });
      }
      const app = appRes.rows[0] as { id: string; status: string };
      const recipients = await computeApplicationRecipients(client, app.id);
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          app.id,
        recipient_user_ids: recipients,
        payload:            { type: 'form_update', applicationId: app.id },
      });
      return app;
    });
    res.json({ message: '申請を更新しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
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
      const schemaRes = await client.query(
        `SELECT COALESCE(v.schema_definition, active_v.schema_definition) AS schema_definition
         FROM applications a
         LEFT JOIN form_template_versions v ON v.id = a.template_version_id
         LEFT JOIN LATERAL (
           SELECT schema_definition
           FROM form_template_versions
           WHERE template_id = a.template_id AND is_active = TRUE
           LIMIT 1
         ) active_v ON TRUE
         WHERE a.id = $1`,
        [req.params.id],
      );
      const normalizedFormData = form_data
        ? applyComputedFormData(schemaRes.rows[0]?.schema_definition, form_data)
        : undefined;
      if (normalizedFormData && schemaRes.rows[0]?.schema_definition) {
        const errors = validateFormData(schemaRes.rows[0].schema_definition, normalizedFormData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
      }

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
      const routePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id),
        applicant_id,
      );
      const resolvedSteps = routePolicy.steps;

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
      if (normalizedFormData) {
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_APPROVAL', route_id = $1,
               submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
               form_data = $2::jsonb
           WHERE id = $3`,
          [route_id, JSON.stringify(normalizedFormData), req.params.id],
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

      // Backward compat: assign number if not already set (older apps lacked one until approval)
      const assignedNumber = await ensureApplicationNumber(client, String(req.params.id));

      let finalApp: { id: string; status: string; application_number: string | null } | null = null;
      if (resolvedSteps.length > 0) {
        await insertApprovalSteps(client, String(req.params.id), 'RINGI', resolvedSteps, offset);
      } else {
        finalApp = await finalizeStageWithoutApprovalSteps(client, String(req.params.id), 'RINGI');
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('RESUBMIT', 'application', $1, $2::jsonb)`,
        [req.params.id, JSON.stringify({
          route_id,
          offset,
          steps: resolvedSteps.length,
          skipped_steps: routePolicy.skipped_steps,
          skipped_through_step_order: routePolicy.skipped_through_step_order,
          auto_approved: resolvedSteps.length === 0,
        })],
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

      return {
        id: req.params.id,
        status: finalApp?.status ?? 'PENDING_APPROVAL',
        application_number: finalApp?.application_number ?? assignedNumber,
        round_offset: offset,
        total_steps: resolvedSteps.length,
        skipped_steps: routePolicy.skipped_steps,
        _recipients: recipients,
      };
    });

    invalidateDashboardCache((result as any)._recipients ?? []);
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
      // Load and lock the draft (join template to know pattern_id + component_type)
      const draftRes = await client.query(
        `SELECT a.id, a.status, a.template_id, t.pattern_id, t.component_type
         FROM applications a JOIN form_templates t ON t.id = a.template_id
         WHERE a.id = $1 AND a.applicant_id = $2 AND a.status = 'DRAFT' FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (draftRes.rows.length === 0) {
        throw Object.assign(new Error('下書きが見つかりません'), { status: 404 });
      }
      const draftRow = draftRes.rows[0] as {
        template_id: string; pattern_id: number; component_type: string | null;
      };
      const template_id        = draftRow.template_id;
      const isDirectSettlement = draftRow.pattern_id === 2;
      const routeStage: ApprovalStage = isDirectSettlement ? 'SETTLEMENT' : 'RINGI';

      // Resolve route — pattern_id picks SETTLEMENT vs RINGI bucket
      let route_id: string = chosen_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = $3 AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id, routeStage],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(
            new Error(isDirectSettlement ? '精算承認ルートが設定されていません' : '承認ルートが設定されていません'),
            { status: 422 },
          );
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, routeStage);
      }

      const submitRoutePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id),
        applicant_id,
      );
      const resolvedSubmitSteps = submitRoutePolicy.steps;

      // Update application: pattern_id=2 → PENDING_SETTLEMENT + settlement_submitted_at, else PENDING_APPROVAL
      const initialStatus = isDirectSettlement ? 'PENDING_SETTLEMENT' : 'PENDING_APPROVAL';
      await client.query(
        `UPDATE applications
         SET status = $3, route_id = $2,
             submitted_at = CURRENT_TIMESTAMP,
             settlement_submitted_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE settlement_submitted_at END
         WHERE id = $1`,
        [req.params.id, route_id, initialStatus, isDirectSettlement],
      );

      const assignedNumber = await ensureApplicationNumber(client, String(req.params.id));

      let finalApp: { id: string; status: string; application_number: string | null } | null = null;
      if (resolvedSubmitSteps.length > 0) {
        await insertApprovalSteps(client, String(req.params.id), routeStage, resolvedSubmitSteps);
      } else {
        finalApp = await finalizeStageWithoutApprovalSteps(client, String(req.params.id), routeStage);
      }

      // Auto-create settlements row for pattern_id=2 (matches POST / behaviour)
      if (isDirectSettlement) {
        const fdRes = await client.query(
          `SELECT a.form_data, COALESCE(v.schema_definition, t.schema_definition) AS schema_def
           FROM applications a
           JOIN form_templates t ON t.id = a.template_id
           LEFT JOIN form_template_versions v ON v.id = a.template_version_id
           WHERE a.id = $1`,
          [req.params.id],
        );
        const fdRow = fdRes.rows[0] as { form_data: Record<string, unknown>; schema_def: any };
        const amount = detectSettlementAmount(fdRow.schema_def, fdRow.form_data ?? {});
        await client.query(
          `INSERT INTO settlements (application_id, expected_amount, actual_amount, settlement_data, status)
           VALUES ($1, $2, $2, '{}'::jsonb, 'PENDING_VERIFICATION')
           ON CONFLICT (application_id) DO NOTHING`,
          [req.params.id, amount],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('DRAFT_SUBMIT', 'application', $1, $2::jsonb)`,
        [req.params.id, JSON.stringify({
          route_id,
          steps: resolvedSubmitSteps.length,
          skipped_steps: submitRoutePolicy.skipped_steps,
          skipped_through_step_order: submitRoutePolicy.skipped_through_step_order,
          auto_approved: resolvedSubmitSteps.length === 0,
        })],
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

      return {
        id: req.params.id,
        status: finalApp?.status ?? 'PENDING_APPROVAL',
        application_number: finalApp?.application_number ?? assignedNumber,
        total_steps: resolvedSubmitSteps.length,
        skipped_steps: submitRoutePolicy.skipped_steps,
        _recipients: recipients,
      };
    });
    invalidateDashboardCache((result as any)._recipients ?? []);
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
        `SELECT a.id, a.template_id, a.template_version_id, a.form_data
         FROM applications a
         WHERE a.id = $1 AND a.applicant_id = $2 AND a.status = 'APPROVED'
         FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('対象の申請が見つかりません（申請者本人かつ承認済みのみ精算可能）'), { status: 404 });
      }
      const { template_id, template_version_id, form_data: originalFormData } = appRes.rows[0] as {
        template_id: string;
        template_version_id: string | null;
        form_data: Record<string, unknown>;
      };

      // Confirm template has settlement_schema
      const tmplRes = await client.query(
        `SELECT COALESCE(v.settlement_schema, active_v.settlement_schema) AS settlement_schema
         FROM form_templates t
         LEFT JOIN form_template_versions v ON v.id = $2
         LEFT JOIN LATERAL (
           SELECT settlement_schema
           FROM form_template_versions
           WHERE template_id = t.id AND is_active = TRUE
           LIMIT 1
         ) active_v ON TRUE
         WHERE t.id = $1 AND COALESCE(v.settlement_schema, active_v.settlement_schema) IS NOT NULL`,
        [template_id, template_version_id],
      );
      if (tmplRes.rows.length === 0) {
        throw Object.assign(new Error('このテンプレートは精算に対応していません'), { status: 422 });
      }
      const settlementSchema = tmplRes.rows[0]?.settlement_schema;
      const normalizedSettlementData = applyComputedFormData(settlementSchema, settlement_data);
      if (settlementSchema) {
        const errors = validateFormData(settlementSchema, normalizedSettlementData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
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
      const settleRoutePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id, '精算ルート'),
        applicant_id,
      );
      const resolvedSteps = settleRoutePolicy.steps;

      // Update application
      await client.query(
        `UPDATE applications
         SET settlement_data = $2::jsonb, status = 'PENDING_SETTLEMENT',
             settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, JSON.stringify(normalizedSettlementData)],
      );

      // Create / update settlements table row for accounting dashboard
      const expectedAmount = parseFloat(String(originalFormData?.expected_amount ?? 0)) || 0;
      // actual_amount may be computed from line_items; fall back to direct field
      const rawActual = normalizedSettlementData?.actual_amount;
      const actualAmount = typeof rawActual === 'number' ? rawActual : parseFloat(String(rawActual ?? 0)) || 0;
      await client.query(
        `INSERT INTO settlements (application_id, expected_amount, actual_amount, settlement_data, status)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING_VERIFICATION')
         ON CONFLICT (application_id) DO UPDATE SET
           actual_amount    = EXCLUDED.actual_amount,
           settlement_data  = EXCLUDED.settlement_data,
           updated_at       = CURRENT_TIMESTAMP`,
        [req.params.id, expectedAmount, actualAmount, JSON.stringify(normalizedSettlementData)],
      );

      // Clear any stale settlement steps (idempotent — safe to resubmit settlement)
      await client.query(
        `DELETE FROM approval_steps
         WHERE application_id = $1 AND stage = 'SETTLEMENT' AND status IN ('PENDING', 'WAITING', 'CANCELLED')`,
        [req.params.id],
      );

      let finalApp: { id: string; status: string; application_number: string | null } | null = null;
      if (resolvedSteps.length > 0) {
        await insertApprovalSteps(client, String(req.params.id), 'SETTLEMENT', resolvedSteps);
      } else {
        finalApp = await finalizeStageWithoutApprovalSteps(client, String(req.params.id), 'SETTLEMENT');
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('SETTLEMENT_START', 'application', $1, $2::jsonb)`,
        [req.params.id, JSON.stringify({
          route_id,
          steps: resolvedSteps.length,
          skipped_steps: settleRoutePolicy.skipped_steps,
          skipped_through_step_order: settleRoutePolicy.skipped_through_step_order,
          auto_approved: resolvedSteps.length === 0,
        })],
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

      return {
        id: req.params.id,
        status: finalApp?.status ?? 'PENDING_SETTLEMENT',
        application_number: finalApp?.application_number ?? null,
        total_settlement_steps: resolvedSteps.length,
        skipped_steps: settleRoutePolicy.skipped_steps,
        _recipients: recipients,
      };
    });

    invalidateDashboardCache((result as any)._recipients ?? []);
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
        `SELECT a.id, a.template_id, a.template_version_id, a.route_id
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

      const { template_id, template_version_id } = appRes.rows[0] as {
        template_id: string;
        template_version_id: string | null;
        route_id: string | null;
      };

      // Fetch pattern_id + component_type — determines data layout + validation behaviour
      const tmplPatternRes = await client.query(
        `SELECT pattern_id, component_type FROM form_templates WHERE id = $1`,
        [template_id],
      );
      const isDirectSettlement = (tmplPatternRes.rows[0]?.pattern_id ?? 1) === 2;
      const skipValidation     = !!tmplPatternRes.rows[0]?.component_type;

      // For pattern_id=2 (direct settlement), schema lives in schema_definition (data is in
      // form_data). For pattern_id=3, settlement-specific fields are in settlement_schema.
      const schemaRes = await client.query(
        isDirectSettlement
          ? `SELECT COALESCE(v.schema_definition, active_v.schema_definition) AS settlement_schema
             FROM form_templates t
             LEFT JOIN form_template_versions v ON v.id = $2
             LEFT JOIN LATERAL (
               SELECT schema_definition
               FROM form_template_versions
               WHERE template_id = t.id AND is_active = TRUE
               LIMIT 1
             ) active_v ON TRUE
             WHERE t.id = $1`
          : `SELECT COALESCE(v.settlement_schema, active_v.settlement_schema) AS settlement_schema
             FROM form_templates t
             LEFT JOIN form_template_versions v ON v.id = $2
             LEFT JOIN LATERAL (
               SELECT settlement_schema
               FROM form_template_versions
               WHERE template_id = t.id AND is_active = TRUE
               LIMIT 1
             ) active_v ON TRUE
             WHERE t.id = $1`,
        [template_id, template_version_id],
      );
      const settlementSchema = schemaRes.rows[0]?.settlement_schema;
      const normalizedSettlementData = applyComputedFormData(settlementSchema, settlement_data);
      // Skip schema validation only for custom-renderer forms (transportation etc.).
      // Admin-built pattern_id=2 forms ARE validated against schema.
      if (settlementSchema && !skipValidation) {
        const errors = validateFormData(settlementSchema, normalizedSettlementData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
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
          throw Object.assign(new Error('精算承認ルートが設定されていません'), { status: 422 });
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        // Caller-supplied — validate scope
        await assertValidRouteForTemplate(client, route_id, template_id, department_id, 'SETTLEMENT');
      }

      // Resolve SETTLEMENT route → concrete steps (single batched role lookup)
      const settleRoutePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id, '精算ルート'),
        applicant_id,
      );
      const resolvedSteps = settleRoutePolicy.steps;

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

      // Update application status.
      // pattern_id=2 (direct settlement): data lives in form_data, not settlement_data.
      // pattern_id=1/3: data goes into settlement_data as usual.
      if (isDirectSettlement) {
        // Re-detect amount from updated form_data (schema may differ from original snapshot,
        // but settlementSchema fallback covers it). Generic for transport + admin-built forms.
        const amount = detectSettlementAmount(settlementSchema ?? null, normalizedSettlementData);
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_SETTLEMENT', form_data = $2::jsonb,
               settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [req.params.id, JSON.stringify(normalizedSettlementData)],
        );
        await client.query(
          `UPDATE settlements
           SET expected_amount = $2, actual_amount = $2, updated_at = CURRENT_TIMESTAMP
           WHERE application_id = $1`,
          [req.params.id, amount],
        );
      } else {
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_SETTLEMENT', settlement_data = $2::jsonb,
               settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [req.params.id, JSON.stringify(normalizedSettlementData)],
        );
        // Update settlements table row
        const rawActual = normalizedSettlementData?.actual_amount;
        const actualAmount = typeof rawActual === 'number' ? rawActual : parseFloat(String(rawActual ?? 0)) || 0;
        await client.query(
          `UPDATE settlements
           SET actual_amount = $2, settlement_data = $3::jsonb, updated_at = CURRENT_TIMESTAMP
           WHERE application_id = $1`,
          [req.params.id, actualAmount, JSON.stringify(normalizedSettlementData)],
        );
      }

      let finalApp: { id: string; status: string; application_number: string | null } | null = null;
      if (resolvedSteps.length > 0) {
        await insertApprovalSteps(client, String(req.params.id), 'SETTLEMENT', resolvedSteps, settleOffset);
      } else {
        finalApp = await finalizeStageWithoutApprovalSteps(client, String(req.params.id), 'SETTLEMENT');
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('SETTLEMENT_RESUBMIT', 'application', $1, $2::jsonb)`,
        [req.params.id, JSON.stringify({
          route_id,
          offset: settleOffset,
          steps: resolvedSteps.length,
          skipped_steps: settleRoutePolicy.skipped_steps,
          skipped_through_step_order: settleRoutePolicy.skipped_through_step_order,
          auto_approved: resolvedSteps.length === 0,
        })],
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

      return {
        id: req.params.id,
        status: finalApp?.status ?? 'PENDING_SETTLEMENT',
        application_number: finalApp?.application_number ?? null,
        total_settlement_steps: resolvedSteps.length,
        skipped_steps: settleRoutePolicy.skipped_steps,
        _recipients: recipients,
      };
    });

    invalidateDashboardCache((result as any)._recipients ?? []);
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
        throw Object.assign(new Error('あなたの部署が設定されていません。管理者にお問い合わせください。'), { status: 422 });
      }

      // Determine flow based on template pattern_id:
      //   pattern_id = 1  → RINGI only  → PENDING_APPROVAL + RINGI steps
      //   pattern_id = 2  → SETTLEMENT only (e.g. transportation) → PENDING_SETTLEMENT + SETTLEMENT steps
      //   pattern_id = 3  → RINGI + SETTLEMENT → same as 1 (settlement added later via start-settlement)
      const tmplRes = await client.query(
        `SELECT pattern_id, component_type FROM form_templates WHERE id = $1`,
        [template_id],
      );
      const pattern_id     = (tmplRes.rows[0]?.pattern_id ?? 1) as number;
      const component_type = (tmplRes.rows[0]?.component_type ?? null) as string | null;
      const isDirectSettlement = pattern_id === 2;
      // Skip validation only for custom-renderer forms (transportation, etc.) —
      // their data shape (entries[] etc.) doesn't fit the standard field schema.
      const skipValidation = !!component_type;
      const routeStage  = isDirectSettlement ? 'SETTLEMENT' : 'RINGI';
      const missingRouteErr = isDirectSettlement
        ? '精算承認ルートが設定されていません。管理者にお問い合わせください。'
        : 'この部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。';

      let route_id: string = chosen_route_id || '';

      if (!route_id) {
        const routeRes = await client.query(
          `SELECT r.id FROM approval_routes r
           WHERE r.template_id = $1 AND r.department_id = $2
             AND r.stage = $3 AND r.is_active = TRUE AND r.is_default = TRUE
           LIMIT 1`,
          [template_id, department_id, routeStage],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(new Error(missingRouteErr), { status: 422 });
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        const verify = await client.query(
          `SELECT id FROM approval_routes
           WHERE id = $1 AND template_id = $2 AND department_id = $3
             AND stage = $4 AND is_active = TRUE`,
          [route_id, template_id, department_id, routeStage],
        );
        if (verify.rows.length === 0) {
          throw Object.assign(
            new Error('選択したルートはこの部署・テンプレートに対して無効です。'),
            { status: 422 },
          );
        }
      }

      // Resolve route → concrete steps (single batched role lookup)
      const routePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id, isDirectSettlement ? '精算ルート' : '承認ルート'),
        applicant_id,
      );
      const resolvedSteps = routePolicy.steps;

      // Capture active form template version — locks schema to what user submitted
      const verRes = await client.query(
        `SELECT id, schema_definition FROM form_template_versions WHERE template_id = $1 AND is_active = TRUE LIMIT 1`,
        [template_id],
      );
      const versionId = verRes.rows[0]?.id ?? null;
      const versionSchema = verRes.rows[0]?.schema_definition;
      const normalizedFormData = applyComputedFormData(versionSchema, form_data);

      // Server-side schema validation — honours conditional_on (hidden fields exempt)
      // Skip for custom-renderer forms (transportation etc.) whose data shape doesn't
      // match a standard field schema. Admin-built pattern_id=2 forms ARE validated.
      if (versionSchema && !skipValidation) {
        const errors = validateFormData(versionSchema, normalizedFormData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
      }

      // Initial status + settlement_submitted_at for direct-settlement forms
      const initialStatus = isDirectSettlement ? 'PENDING_SETTLEMENT' : 'PENDING_APPROVAL';

      const appRes = await client.query(
        `INSERT INTO applications
           (applicant_id, template_id, template_version_id, route_id, form_data, status,
            submitted_at, settlement_submitted_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, CURRENT_TIMESTAMP, $7)
         RETURNING id, status`,
        [
          applicant_id, template_id, versionId, route_id,
          JSON.stringify(normalizedFormData), initialStatus,
          isDirectSettlement ? new Date() : null,
        ],
      );
      let app = appRes.rows[0] as { id: string; status: string; application_number?: string | null };

      // Assign application_number immediately on submit
      const assignedNumber = await ensureApplicationNumber(client, app.id);
      app.application_number = assignedNumber;

      if (resolvedSteps.length > 0) {
        await insertApprovalSteps(client, app.id, routeStage as ApprovalStage, resolvedSteps);
      } else {
        app = await finalizeStageWithoutApprovalSteps(client, app.id, routeStage as ApprovalStage);
      }

      // Auto-create settlements record for pattern_id=2 so the accounting page can
      // list the app, set transfer_date, upload proof, and close it — same as pattern 3.
      // Amount detection works for both transportation (grand_total) and admin-built
      // settlement forms (uses computed/sum_target/first number field).
      if (isDirectSettlement) {
        const amount = detectSettlementAmount(versionSchema, normalizedFormData);
        await client.query(
          `INSERT INTO settlements
             (application_id, expected_amount, actual_amount, settlement_data, status)
           VALUES ($1, $2, $2, '{}'::jsonb, 'PENDING_VERIFICATION')
           ON CONFLICT (application_id) DO NOTHING`,
          [app.id, amount],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPLICATION_SUBMIT', 'application', $1, $2::jsonb)`,
        [app.id, JSON.stringify({
          template_id,
          stage: isDirectSettlement ? 'SETTLEMENT' : (stage ?? 'RINGI'),
          pattern_id,
          steps: resolvedSteps.length,
          skipped_steps: routePolicy.skipped_steps,
          skipped_through_step_order: routePolicy.skipped_through_step_order,
          auto_approved: resolvedSteps.length === 0,
        })],
      );

      const recipients = await computeApplicationRecipients(client, app.id);
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          app.id,
        recipient_user_ids: recipients,
        payload:            { type: 'submit', applicationId: app.id },
      });

      return { ...app, total_steps: resolvedSteps.length, skipped_steps: routePolicy.skipped_steps };
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
  const limit  = parsePageLimit(req.query.limit, APP_PAGE_SIZE, 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const status = ((req.query.status as string | undefined) ?? 'ALL').toUpperCase();
  const cursor = decodeCursor(req.query.cursor);
  const includeArchived = req.query.include_archived === 'true';

  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.created_at, a.submitted_at,
         a.settlement_submitted_at,
         a.form_data, a.settlement_data, a.template_id,
         t.title_ja AS template_name, t.code AS template_code,
         t.settlement_schema IS NOT NULL AS has_settlement,
         t.pattern_id,
         COALESCE((
           SELECT COUNT(*)::int FROM approval_steps
           WHERE application_id = a.id
             AND stage = ps.stage
             AND step_order / 100 = ps.batch
             AND step_order <= ps.step_order
         ), 0) AS current_step,
         COALESCE((
           SELECT COUNT(*)::int FROM approval_steps
           WHERE application_id = a.id
             AND stage = ps.stage
             AND step_order / 100 = ps.batch
         ), 0) AS total_steps
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN LATERAL (
         SELECT s.step_order, s.stage, s.step_order / 100 AS batch
         FROM approval_steps s
         WHERE s.application_id = a.id AND s.status = 'PENDING'
         ORDER BY s.step_order ASC LIMIT 1
       ) ps ON TRUE
       WHERE a.applicant_id = $1
         AND ($2 = 'ALL' OR a.status = $2)
         AND ($7::boolean OR a.archived_at IS NULL)
         AND (
           $3::timestamptz IS NULL
           OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid)
         )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5 OFFSET $6`,
      [req.user!.id, status, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1, cursor ? 0 : offset, includeArchived],
    );
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    // Batch-load active schemas for unique templates in this page.
    // Uses idx_form_template_versions_active (partial index, fast).
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

    // Extract row_preview per row; exclude raw form_data / settlement_data / template_id
    const items = rows.map((r: any) => {
      const schemas = schemaMap.get(r.template_id);
      const row_preview = extractRowPreview(
        schemas?.schema_definition,
        r.form_data,
        schemas?.settlement_schema,
        r.settlement_data,
      );
      const { form_data: _fd, settlement_data: _sd, template_id: _tid, ...rest } = r;
      return { ...rest, row_preview };
    });

    res.json({
      items,
      hasMore,
      offset,
      nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    });
  } catch (err) {
    console.error('[applications] list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

// GET /applications/:id — full detail + approval timeline
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Authorization: must be applicant, assigned approver, prior actor,
    //    same-dept manager+, SOUMU, or ADMIN
    await assertCanReadApp({ id: req.user!.id, role: req.user!.role, is_admin: req.user!.is_admin }, String(req.params.id));

    // Schema resolution: prefer the locked version (form_template_versions row
    // captured at submit time). Falls back to current form_templates schema
    // only for legacy rows missing template_version_id (pre-migration 018).
    // COALESCE keeps the contract identical for the frontend.
    const appRes = await query(
      `SELECT a.id, a.application_number, a.status, a.form_data, a.version,
              a.settlement_data, a.settlement_submitted_at,
              a.template_id, a.template_version_id,
              a.created_at, a.submitted_at, a.completed_at,
              t.title_ja AS template_name, t.code AS template_code,
              COALESCE(v.schema_definition, t.schema_definition) AS schema_definition,
              COALESCE(v.settlement_schema, t.settlement_schema) AS settlement_schema,
              v.version_number AS template_version_number,
              t.settlement_schema IS NOT NULL AS has_settlement,
         t.pattern_id,
              t.component_type,
              u.full_name AS applicant_name,
              u.avatar_url AS applicant_avatar,
              u.daily_allowance_rate AS applicant_daily_rate,
              s.transfer_date, s.transfer_proof_url, s.accounting_note,
              s.expected_amount, s.actual_amount AS settled_actual_amount,
              s.processed_at AS settlement_processed_at,
              s.status AS settlement_status
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN form_template_versions v ON v.id = a.template_version_id
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
    await withTransaction(async (client: pg.PoolClient) => {
      const result = await client.query(
        `DELETE FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT'
         RETURNING id`,
        [req.params.id, req.user!.id],
      );
      if (result.rows.length === 0) {
        throw Object.assign(new Error('下書きが見つかりません（または削除権限がありません）'), { status: 404 });
      }
      const app = result.rows[0] as { id: string };
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          app.id,
        recipient_user_ids: [req.user!.id],
        payload:            { type: 'draft_delete', applicationId: app.id },
      });
      return app;
    });
    res.json({ message: '下書きを削除しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] draft delete failed:', err);
    res.status(500).json({ error: '下書きの削除に失敗しました' });
  }
});

export default router;
