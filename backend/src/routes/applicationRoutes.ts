import { Router, Request, Response } from 'express';
import { query, pool, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { assertCanReadApp } from '../middlewares/authz';
import { mutationLimiter } from '../middlewares/rateLimit';
import { skipStepsThroughApplicant, type ResolvedStep } from '../services/approvalStepService';
import { resolveChainFromUserSlots, previewChainForUser } from '../services/approvalChainService';
import { applyComputedFormData, validateFormData } from '../services/formValidation';
import { insertOutboxEvent } from '../services/eventOutbox';
import { deleteFilesForApplication } from '../services/fileCleanup';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { invalidateDashboardCache }  from '../services/dashboardCache';
import { getJsonCache, setJsonCache, invalidateCachePattern } from '../services/cache';
import { notifyApplicationEvent }   from '../services/notificationService';
import { decodeCursor, encodeCursor, parsePageLimit } from '../services/pagination';
import { extractRowPreview } from '../services/rowPreview';
import { validateBody } from '../middlewares/validate';

const ROUTE_PREVIEW_HARD_TTL = 7200; // 2 h — routes almost never change

/** Called by adminRoutes when any route/step is mutated (legacy system). */
export async function invalidateRoutePreviews(templateId: string): Promise<void> {
  await invalidateCachePattern(`route-preview:${templateId}:*`);
}

/** Called by adminRoutes when user slot assignments or template patterns change. */
export async function invalidateChainPreviews(userOrTemplateId: string): Promise<void> {
  await Promise.all([
    invalidateCachePattern(`chain-preview:*:${userOrTemplateId}`),
    invalidateCachePattern(`chain-preview:${userOrTemplateId}:*`),
  ]);
}
import {
  createApplicationSchema, type CreateApplicationBody,
  saveApplicationSchema, type SaveApplicationBody,
  submitApplicationSchema, type SubmitApplicationBody,
  startSettlementSchema, type StartSettlementBody,
  submitSettlementSchema, type SubmitSettlementBody,
  adminSubmitSchema, type AdminSubmitBody,
} from '../schemas/applicationSchemas';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
// Per-IP cap of 300 req/min — protects DB from runaway clients
router.use(mutationLimiter);

type ApprovalStage = 'RINGI' | 'SETTLEMENT';

// Resolve the headline amount for a form submission.
// Used to populate settlements.expected_amount / actual_amount so the accounting page sees the total.
//
// Detection order (first hit wins):
//   1. Explicit `amount_field: true` on any number field (admin-designated in form builder)
//   2. Last `computed: true` number field that has a `formula` (most-derived formula result)
//   3. Explicit `grand_total` key in formData (transportation form convention)
//   4. Last `computed: true` number field with `sum_target` (aggregated total)
//   5. Last `computed: true` number field (any)
//   6. First plain number field
//   7. 0 (no numeric fields found)
interface AmountField {
  name: string; type: string;
  computed?: boolean; sum_target?: string; formula?: string; amount_field?: boolean;
}
function detectSettlementAmount(
  schema:   { fields?: AmountField[] } | null | undefined,
  formData: Record<string, unknown>,
): number {
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
    return isFinite(n) ? n : 0;
  };
  const fields = (schema?.fields ?? []).filter((f) => f.type === 'number');
  // 1. Explicit designation
  const explicit = fields.filter((f) => f.amount_field);
  if (explicit.length > 0) return num(formData[explicit[explicit.length - 1].name]);
  // 2. Formula-based computed (last = most derived)
  const formulaComputed = fields.filter((f) => f.computed && f.formula);
  if (formulaComputed.length > 0) return num(formData[formulaComputed[formulaComputed.length - 1].name]);
  // 3. grand_total convention
  if (formData.grand_total != null) return num(formData.grand_total);
  // 4. Sum-target computed (last)
  const sumComputed = fields.filter((f) => f.computed && f.sum_target);
  if (sumComputed.length > 0) return num(formData[sumComputed[sumComputed.length - 1].name]);
  // 5. Any computed (last)
  const anyComputed = fields.filter((f) => f.computed);
  if (anyComputed.length > 0) return num(formData[anyComputed[anyComputed.length - 1].name]);
  // 6. First number field
  if (fields.length > 0) return num(formData[fields[0].name]);
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
  let status: string;
  if (stage === 'SETTLEMENT') {
    status = 'SETTLEMENT_APPROVED';
  } else {
    // Pattern 1 = ringi-only: no settlement phase → complete immediately
    const ptRes = await client.query(
      `SELECT ft.pattern_id FROM applications a JOIN form_templates ft ON ft.id = a.template_id WHERE a.id = $1`,
      [appId],
    );
    const patternId: number = ptRes.rows[0]?.pattern_id ?? 1;
    status = patternId === 1 ? 'COMPLETED' : 'APPROVED';
  }
  const completedNow = status === 'COMPLETED';
  const appRes = await client.query(
    `UPDATE applications
     SET status = $2,
         application_number = COALESCE(application_number, $3),
         updated_at = CURRENT_TIMESTAMP
         ${completedNow ? ', completed_at = CURRENT_TIMESTAMP' : ''}
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
  if (steps.length === 0) return;
  // Single bulk INSERT — one round-trip regardless of step count
  const values: unknown[] = [];
  const placeholders = steps.map((s, i) => {
    const base = i * 7;
    values.push(appId, offset + s.step_order, stage, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING');
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  await client.query(
    `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

// GET /applications/route-preview?template_id=X&pattern_id=Y (optional)
// Returns the chain this user would see for the given template + pattern.
// Chain is per-user (slot assignments differ per person), cached 5 min.
router.get('/route-preview', async (req: Request, res: Response): Promise<void> => {
  const { template_id, pattern_id } = req.query as { template_id?: string; pattern_id?: string };
  const applicantId = req.user!.id;

  if (!template_id) { res.status(400).json({ error: 'template_id required' }); return; }

  const cacheKey = `chain-preview:${template_id}:${applicantId}${pattern_id ? `:${pattern_id}` : ''}`;

  try {
    const cached = await getJsonCache(cacheKey);
    if (cached) { res.json(cached); return; }

    const client = await pool.connect();
    try {
      const preview = await previewChainForUser(client, applicantId, template_id, pattern_id);

      const applicantTrim = skipStepsThroughApplicant(preview.steps, applicantId);
      const result = {
        routes: [{
          id:           preview.pattern_id,
          name:         preview.pattern_name,
          is_default:   true,
          steps:        applicantTrim.steps,
          skipped_steps: applicantTrim.skipped_steps,
        }],
        all_patterns:        preview.all_patterns,
        department_has_route: preview.steps.length > 0 || preview.all_patterns.length > 0,
      };
      void setJsonCache(cacheKey, result, 300); // 5 min — user-specific, refreshes quickly
      res.json(result);
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 422) { res.status(422).json({ error: e.message }); return; }
    console.error('[applications] route-preview failed:', err);
    res.status(500).json({ error: 'ルートの取得に失敗しました' });
  }
});

// POST /applications/draft — save a draft (no approval steps, no route required)
router.post('/draft', validateBody(createApplicationSchema), async (req: Request, res: Response): Promise<void> => {
  const { template_id, form_data } = req.body as CreateApplicationBody;
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
router.patch('/:id', validateBody(saveApplicationSchema), async (req: Request, res: Response): Promise<void> => {
  const { form_data } = req.body as SaveApplicationBody;
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
router.post('/:id/resubmit', validateBody(submitApplicationSchema), async (req: Request, res: Response): Promise<void> => {
  const { form_data, pattern_id: chosen_pattern_id } = req.body as SubmitApplicationBody;
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock RETURNED application owned by applicant
      const appRes = await client.query(
        `SELECT id, template_id FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'RETURNED' FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('差し戻し済み申請が見つかりません'), { status: 404 });
      }
      const { template_id } = appRes.rows[0] as {
        template_id: string;
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

      // Resolve chain via User × Pattern model
      const { steps: rawSteps, patternId: resolvedPatternId } = await resolveChainFromUserSlots(client, {
        applicantId:  applicant_id,
        departmentId: department_id,
        templateId:   template_id,
        formData:     typeof form_data === 'object' && form_data ? form_data : {},
        patternId:    chosen_pattern_id ?? undefined,
        stageFilter:  'RINGI',
      });
      const routePolicy = skipStepsThroughApplicant(rawSteps, applicant_id);
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
           SET status = 'PENDING_APPROVAL', approval_pattern_id = $1,
               submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
               form_data = $2::jsonb
           WHERE id = $3`,
          [resolvedPatternId, JSON.stringify(normalizedFormData), req.params.id],
        );
      } else {
        await client.query(
          `UPDATE applications
           SET status = 'PENDING_APPROVAL', approval_pattern_id = $1,
               submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [resolvedPatternId, req.params.id],
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
          pattern_id: resolvedPatternId,
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
  const { pattern_id: chosen_pattern_id } = req.body as { pattern_id?: string };
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

      // Resolve chain via User × Pattern model
      const { steps: rawSubmitSteps, patternId: resolvedPatternId } = await resolveChainFromUserSlots(client, {
        applicantId:  applicant_id,
        departmentId: department_id,
        templateId:   template_id,
        formData:     {},
        patternId:    chosen_pattern_id ?? undefined,
        stageFilter:  routeStage as 'RINGI' | 'SETTLEMENT',
      });
      const submitRoutePolicy = skipStepsThroughApplicant(rawSubmitSteps, applicant_id);
      const resolvedSubmitSteps = submitRoutePolicy.steps;

      // Update application: pattern_id=2 → PENDING_SETTLEMENT + settlement_submitted_at, else PENDING_APPROVAL
      const initialStatus = isDirectSettlement ? 'PENDING_SETTLEMENT' : 'PENDING_APPROVAL';
      await client.query(
        `UPDATE applications
         SET status = $3, approval_pattern_id = $2,
             submitted_at = CURRENT_TIMESTAMP,
             settlement_submitted_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE settlement_submitted_at END
         WHERE id = $1`,
        [req.params.id, resolvedPatternId, initialStatus, isDirectSettlement],
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
          pattern_id: resolvedPatternId,
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
    notifyApplicationEvent('APP_SUBMITTED', String(req.params.id));
    res.json({ message: '申請を提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] draft submit failed:', err);
    res.status(500).json({ error: '申請の提出に失敗しました' });
  }
});

// POST /applications/:id/start-settlement — APPROVED app → PENDING_SETTLEMENT
router.post('/:id/start-settlement', validateBody(startSettlementSchema), async (req: Request, res: Response): Promise<void> => {
  const { settlement_data, pattern_id: chosen_pattern_id } = req.body as StartSettlementBody;
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
      // Read applicant's daily rate fresh from allowance_rates (not the cached users column)
      // so any admin changes to rates are reflected immediately without waiting for re-login.
      const rateRes = await client.query(
        `SELECT COALESCE(ar.daily_rate_yen, u.daily_allowance_rate, 3000)::int AS daily_rate
         FROM users u
         LEFT JOIN allowance_rates ar ON ar.role = u.role
         WHERE u.id = $1`,
        [applicant_id],
      );
      const dailyRate: number = rateRes.rows[0]?.daily_rate ?? 3000;
      const normalizedSettlementData = applyComputedFormData(settlementSchema, { _daily_rate: dailyRate, ...settlement_data });
      if (settlementSchema) {
        const errors = validateFormData(settlementSchema, normalizedSettlementData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
      }

      // Resolve SETTLEMENT chain via User × Pattern model
      const { steps: rawSettleSteps, patternId: resolvedPatternId } = await resolveChainFromUserSlots(client, {
        applicantId:  applicant_id,
        departmentId: department_id,
        templateId:   template_id,
        formData:     settlement_data ?? {},
        patternId:    chosen_pattern_id ?? undefined,
        stageFilter:  'SETTLEMENT',
      });
      const settleRoutePolicy = skipStepsThroughApplicant(rawSettleSteps, applicant_id);
      const resolvedSteps = settleRoutePolicy.steps;

      // Update application
      await client.query(
        `UPDATE applications
         SET settlement_data = $2::jsonb, status = 'PENDING_SETTLEMENT',
             settlement_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, JSON.stringify(normalizedSettlementData)],
      );

      // Create / update settlements table row for accounting dashboard.
      // Resolve the total via the shared detector (handles each form's amount
      // field — e.g. BUSINESS_TRIP's settlement_total — not a hardcoded key).
      const expectedAmount = parseFloat(String(originalFormData?.expected_amount ?? 0)) || 0;
      const actualAmount = detectSettlementAmount(settlementSchema ?? null, normalizedSettlementData);
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
          pattern_id: resolvedPatternId,
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
    notifyApplicationEvent('SETTLEMENT_SUBMITTED', String(req.params.id));
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
router.post('/:id/resubmit-settlement', validateBody(submitSettlementSchema), async (req: Request, res: Response): Promise<void> => {
  const { settlement_data, pattern_id: chosen_pattern_id } = req.body as SubmitSettlementBody;
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock app — must be RETURNED with a settlement step that was returned
      const appRes = await client.query(
        `SELECT a.id, a.template_id, a.template_version_id
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

      // Resolve SETTLEMENT chain via User × Pattern model
      const { steps: rawResubmitSettleSteps, patternId: resolvedPatternId } = await resolveChainFromUserSlots(client, {
        applicantId:  applicant_id,
        departmentId: department_id,
        templateId:   template_id,
        formData:     settlement_data ?? {},
        patternId:    chosen_pattern_id ?? undefined,
        stageFilter:  'SETTLEMENT',
      });
      const settleRoutePolicy = skipStepsThroughApplicant(rawResubmitSettleSteps, applicant_id);
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
        // Update settlements table row — resolve total via shared detector
        // (same fix as the direct branch; not a hardcoded actual_amount key).
        const actualAmount = detectSettlementAmount(settlementSchema, normalizedSettlementData);
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
          pattern_id: resolvedPatternId,
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
    notifyApplicationEvent('SETTLEMENT_SUBMITTED', String(req.params.id));
    res.json({ message: '精算を再提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] resubmit-settlement failed:', err);
    res.status(500).json({ error: '精算の再提出に失敗しました' });
  }
});

// POST /applications — submit new ringi
router.post('/', validateBody(adminSubmitSchema), async (req: Request, res: Response): Promise<void> => {
  const { template_id, stage, form_data, pattern_id: chosen_pattern_id } = req.body as AdminSubmitBody;

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
      // Resolve chain via User × Pattern model
      const { steps: rawDirectSteps, patternId: resolvedPatternId } = await resolveChainFromUserSlots(client, {
        applicantId:  applicant_id,
        departmentId: department_id,
        templateId:   template_id,
        formData:     form_data ?? {},
        patternId:    chosen_pattern_id ?? undefined,
        stageFilter:  routeStage as 'RINGI' | 'SETTLEMENT',
      });
      const routePolicy = skipStepsThroughApplicant(rawDirectSteps, applicant_id);
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
           (applicant_id, template_id, template_version_id, approval_pattern_id, form_data, status,
            submitted_at, settlement_submitted_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, CURRENT_TIMESTAMP, $7)
         RETURNING id, status`,
        [
          applicant_id, template_id, versionId, resolvedPatternId,
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
          workflow_pattern: pattern_id,
          approval_pattern_id: resolvedPatternId,
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

      return { ...app, total_steps: resolvedSteps.length, skipped_steps: routePolicy.skipped_steps, _recipients: recipients };
    });

    invalidateDashboardCache((result as any)._recipients ?? []);
    notifyApplicationEvent('APP_SUBMITTED', String((result as any).id));
    res.status(201).json({ message: '申請が完了しました！', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] submit failed:', err);
    res.status(500).json({ error: '申請の保存に失敗しました' });
  }
});

// GET /applications — applicant's own list  (paginated)
// ?limit=25&offset=0&status=DRAFT&q=osaka  (status omit or 'ALL' = no filter; q = free-text search)
const APP_PAGE_SIZE = 25;
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit  = parsePageLimit(req.query.limit, APP_PAGE_SIZE, 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const status = ((req.query.status as string | undefined) ?? 'ALL').toUpperCase();
  const cursor = decodeCursor(req.query.cursor);
  // Archive visibility:
  //   ?archived=only    → ONLY archived rows (the History "Archived" view)
  //   ?include_archived=true (or ?archived=include) → active + archived
  //   default           → active only (archived_at IS NULL)
  const archivedMode = req.query.archived === 'only'
    ? 'only'
    : (req.query.include_archived === 'true' || req.query.archived === 'include')
      ? 'include'
      : 'exclude';
  // Free-text search: application_number, form_data subject, template name
  // Trimmed, lowercased, min 2 chars enforced client-side (skip empty/short server-side too)
  const rawQ = ((req.query.q as string | undefined) ?? '').trim();
  const searchQ = rawQ.length >= 2 ? rawQ : null;

  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.created_at, a.submitted_at,
         a.settlement_submitted_at, a.archived_at,
         a.form_data, a.settlement_data, a.template_id,
         t.title_ja AS template_name, t.title AS template_title_en, t.code AS template_code,
         t.settlement_schema IS NOT NULL AS has_settlement,
         t.pattern_id,
         COALESCE((
           SELECT COUNT(*)::int FROM approval_steps
           WHERE application_id = a.id
             AND stage = ps.stage
             AND step_order / 100 = ps.batch
             AND step_order <= ps.step_order
             AND status != 'CANCELLED'
         ), 0) AS current_step,
         COALESCE((
           SELECT COUNT(*)::int FROM approval_steps
           WHERE application_id = a.id
             AND stage = ps.stage
             AND step_order / 100 = ps.batch
             AND status != 'CANCELLED'
         ), 0) AS total_steps,
         -- settlement_returned: RETURNED app whose returned step is in the
         -- SETTLEMENT phase. Frontend routes these to the settlement-pending
         -- bucket (edit & resend), not the ringi返し戻し bucket.
         (a.status = 'RETURNED' AND EXISTS (
            SELECT 1 FROM approval_steps sr
            WHERE sr.application_id = a.id
              AND sr.stage = 'SETTLEMENT' AND sr.status = 'RETURNED'
         )) AS settlement_returned
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN LATERAL (
         SELECT s.step_order, s.stage, s.step_order / 100 AS batch
         FROM approval_steps s
         WHERE s.application_id = a.id AND s.status = 'PENDING'
         ORDER BY s.step_order ASC LIMIT 1
       ) ps ON TRUE
       WHERE a.applicant_id = $1
         AND (
           $2 = 'ALL'
           -- UNSETTLED (virtual): pattern-3 ringi-approved awaiting settlement
           -- (APPROVED) + settlement-phase returns (edit & resend in place).
           OR ($2 = 'UNSETTLED' AND (
                 a.status = 'APPROVED'
                 OR (a.status = 'RETURNED' AND EXISTS (
                       SELECT 1 FROM approval_steps s
                       WHERE s.application_id = a.id
                         AND s.stage = 'SETTLEMENT' AND s.status = 'RETURNED'
                 ))
              ))
           -- RETURNED bucket = ringi returns ONLY. Settlement returns live in
           -- the unsettled area, not here.
           OR ($2 = 'RETURNED' AND a.status = 'RETURNED' AND NOT EXISTS (
                 SELECT 1 FROM approval_steps s
                 WHERE s.application_id = a.id
                   AND s.stage = 'SETTLEMENT' AND s.status = 'RETURNED'
              ))
           OR ($2 NOT IN ('ALL','UNSETTLED','RETURNED') AND a.status = $2)
         )
         AND (
           $7 = 'include'
           OR ($7 = 'exclude' AND a.archived_at IS NULL)
           OR ($7 = 'only'    AND a.archived_at IS NOT NULL)
         )
         AND (
           $3::timestamptz IS NULL
           OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid)
         )
         AND (
           $8::text IS NULL
           OR a.application_number ILIKE '%' || $8 || '%'
           OR (a.form_data->>'subject') ILIKE '%' || $8 || '%'
           OR t.title_ja ILIKE '%' || $8 || '%'
           OR t.title ILIKE '%' || $8 || '%'
         )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5 OFFSET $6`,
      [req.user!.id, status, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1, cursor ? 0 : offset, archivedMode, searchQ],
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
              t.title_ja AS template_name, t.title AS template_title_en, t.code AS template_code,
              COALESCE(v.schema_definition, t.schema_definition) AS schema_definition,
              COALESCE(v.settlement_schema, t.settlement_schema) AS settlement_schema,
              v.version_number AS template_version_number,
              t.settlement_schema IS NOT NULL AS has_settlement,
         t.pattern_id,
              t.component_type,
              u.full_name AS applicant_name,
              u.avatar_url AS applicant_avatar,
              COALESCE(ar.daily_rate_yen, u.daily_allowance_rate, 3000)::int AS applicant_daily_rate,
              s.transfer_date, s.transfer_proof_url, s.accounting_note,
              s.expected_amount,
              COALESCE(s.adjusted_amount, s.actual_amount) AS settled_actual_amount,
              s.adjusted_amount, s.adjustment_reason, s.adjusted_at,
              adj_u.full_name AS adjusted_by_name,
              s.processed_at AS settlement_processed_at,
              s.status AS settlement_status
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN form_template_versions v ON v.id = a.template_version_id
       LEFT JOIN users u ON a.applicant_id = u.id
       LEFT JOIN allowance_rates ar ON ar.role = u.role
       LEFT JOIN settlements s ON s.application_id = a.id
       LEFT JOIN users adj_u ON adj_u.id = s.adjusted_by
       WHERE a.id = $1`,
      [req.params.id],
    );
    if (appRes.rows.length === 0) { res.status(404).json({ error: 'Application not found' }); return; }

    const stepsRes = await query(
      `SELECT s.step_order, s.stage, s.status, s.label, s.action_type,
              s.comment, s.acted_at, s.approver_id, u.full_name AS approver_name
       FROM approval_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.application_id = $1
       ORDER BY s.stage, s.step_order`,
      [req.params.id],
    );

    // can_approve = user has a PENDING step AND no earlier step in the same stage is still PENDING
    const myPendingStep = stepsRes.rows.find(
      (s) => s.approver_id === req.user!.id && s.status === 'PENDING',
    );
    // PENDING check: same stage, lower order, not cancelled. Null-safe: if stage is null
    // (legacy pre-stage-migration rows) compare as null === null which is fine — all null-stage
    // steps share the same implicit "ringi" group, so ordering still applies correctly.
    const can_approve = !!myPendingStep && !stepsRes.rows.some(
      (s) => s.stage === myPendingStep.stage &&
             s.step_order < myPendingStep.step_order &&
             s.status === 'PENDING' &&
             s.status !== 'CANCELLED',
    );

    res.json({ ...appRes.rows[0], steps: stepsRes.rows, can_approve });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] detail failed:', err);
    res.status(500).json({ error: '申請詳細の取得に失敗しました' });
  }
});

// DELETE /applications/:id — delete own DRAFT only.
// Physical files (Drive / local FS) are purged BEFORE the DB DELETE so the
// uploaded_files rows are still queryable. ON DELETE CASCADE then removes them.
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      // Verify ownership + DRAFT status before touching anything
      const check = await client.query(
        `SELECT id FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT'`,
        [req.params.id, req.user!.id],
      );
      if (check.rows.length === 0) {
        throw Object.assign(
          new Error('下書きが見つかりません（または削除権限がありません）'),
          { status: 404 },
        );
      }

      // Purge physical files first — CASCADE will clean DB rows after app delete
      await deleteFilesForApplication(req.params.id as string, client);

      const result = await client.query(
        `DELETE FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT'
         RETURNING id`,
        [req.params.id, req.user!.id],
      );
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
    invalidateDashboardCache([req.user!.id]);
    res.json({ message: '下書きを削除しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] draft delete failed:', err);
    res.status(500).json({ error: '下書きの削除に失敗しました' });
  }
});

export default router;
