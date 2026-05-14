import { Router, Request, Response } from 'express';
import { withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(mutationLimiter);

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
        `SELECT status, template_id FROM applications
         WHERE id = $1 AND applicant_id = $2 FOR UPDATE`,
        [application_id, applicant_id],
      );
      if (appRes.rows.length === 0 || appRes.rows[0].status !== 'APPROVED') {
        throw Object.assign(new Error('この申請はまだ精算できる状態ではありません。'), { status: 400 });
      }

      const settleRes = await client.query(
        `INSERT INTO settlements (application_id, actual_amount, settlement_data, status)
         VALUES ($1, $2, $3::jsonb, 'PENDING_VERIFICATION')
         RETURNING id`,
        [application_id, actual_amount, JSON.stringify(settlement_data)],
      );

      await client.query(
        `UPDATE applications SET status = 'PENDING_SETTLEMENT' WHERE id = $1`,
        [application_id],
      );

      const stepsRes = await client.query(
        `SELECT id, step_order, approver_id, label, action_type
         FROM approval_route_steps WHERE route_id = $1 ORDER BY step_order ASC`,
        [route_id],
      );

      for (let i = 0; i < stepsRes.rows.length; i++) {
        const s = stepsRes.rows[i] as {
          id: string; step_order: number; approver_id: string; label: string; action_type: string;
        };
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'SETTLEMENT', $3, $4, $5, $6)`,
          [application_id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id)
         VALUES ('SETTLEMENT_SUBMIT', 'application', $1)`,
        [application_id],
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
