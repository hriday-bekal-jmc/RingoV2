import { Router, Request, Response } from 'express';
import { withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { resolveApprovalSteps, skipStepsThroughApplicant, type ResolvedStep } from '../services/approvalStepService';
import { applyComputedFormData, validateFormData } from '../services/formValidation';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(mutationLimiter);

async function insertSettlementApprovalSteps(
  client: pg.PoolClient,
  applicationId: string,
  steps: ResolvedStep[],
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await client.query(
      `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
       VALUES ($1, $2, 'SETTLEMENT', $3, $4, $5, $6)`,
      [applicationId, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
    );
  }
}

// POST /settlements — create settlement and start settlement approval route
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { application_id, actual_amount, settlement_data, route_id } = req.body as {
    application_id: string;
    actual_amount: number;
    settlement_data: Record<string, unknown>;
    route_id: string;
  };
  const applicant_id = req.user!.id;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const appRes = await client.query(
        `SELECT status, template_id, template_version_id FROM applications
         WHERE id = $1 AND applicant_id = $2 FOR UPDATE`,
        [application_id, applicant_id],
      );
      if (appRes.rows.length === 0 || appRes.rows[0].status !== 'APPROVED') {
        throw Object.assign(new Error('この申請はまだ精算できる状態ではありません。'), { status: 400 });
      }

      const app = appRes.rows[0] as { template_id: string; template_version_id: string | null };
      const schemaRes = await client.query(
        `SELECT COALESCE(v.settlement_schema, active_v.settlement_schema) AS settlement_schema
         FROM form_templates t
         LEFT JOIN form_template_versions v ON v.id = $2
         LEFT JOIN LATERAL (
           SELECT settlement_schema
           FROM form_template_versions
           WHERE template_id = t.id AND is_active = TRUE
           LIMIT 1
         ) active_v ON TRUE
         WHERE t.id = $1`,
        [app.template_id, app.template_version_id],
      );
      const settlementSchema = schemaRes.rows[0]?.settlement_schema;
      const normalizedSettlementData = applyComputedFormData(settlementSchema, settlement_data);
      if (settlementSchema) {
        const errors = validateFormData(settlementSchema, normalizedSettlementData);
        if (errors.length > 0) {
          throw Object.assign(new Error(errors.map(e => e.message).join(' / ')), { status: 400 });
        }
      }
      const normalizedActualAmount = Number(normalizedSettlementData.actual_amount ?? actual_amount) || 0;

      const settleRes = await client.query(
        `INSERT INTO settlements (application_id, actual_amount, settlement_data, status)
         VALUES ($1, $2, $3::jsonb, 'PENDING_VERIFICATION')
         RETURNING id`,
        [application_id, normalizedActualAmount, JSON.stringify(normalizedSettlementData)],
      );

      await client.query(
        `UPDATE applications SET status = 'PENDING_SETTLEMENT' WHERE id = $1`,
        [application_id],
      );

      const routePolicy = skipStepsThroughApplicant(
        await resolveApprovalSteps(client, route_id, '精算ルート'),
        applicant_id,
      );
      const resolvedSteps = routePolicy.steps;

      if (resolvedSteps.length > 0) {
        await insertSettlementApprovalSteps(client, application_id, resolvedSteps);
      } else {
        await client.query(
          `UPDATE applications SET status = 'SETTLEMENT_APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [application_id],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('SETTLEMENT_SUBMIT', 'application', $1, $2::jsonb)`,
        [application_id, JSON.stringify({
          route_id,
          steps: resolvedSteps.length,
          skipped_steps: routePolicy.skipped_steps,
          skipped_through_step_order: routePolicy.skipped_through_step_order,
          auto_approved: resolvedSteps.length === 0,
        })],
      );

      const recipients = await computeApplicationRecipients(client, application_id, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_SUBMITTED',
        entity_type:        'application',
        entity_id:          application_id,
        recipient_user_ids: recipients,
        payload:            { type: 'settlement_start', applicationId: application_id },
      });

      return settleRes.rows[0] as { id: string };
    });

    res.status(201).json({ message: '精算申請を提出しました', settlement: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[settlements] create failed:', err);
    res.status(500).json({ error: '精算の作成に失敗しました' });
  }
});

export default router;
