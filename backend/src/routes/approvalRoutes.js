import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// GET /approvals/pending — applications waiting for the current user's approval
// ADMIN sees all; others see only steps assigned to them (or unassigned steps)
router.get('/pending', async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    const result = await query(`
      SELECT
        a.id,
        a.application_number,
        a.status,
        a.form_data,
        a.created_at,
        t.title_ja AS template_name,
        u.full_name AS applicant_name,
        s.id AS current_step_id,
        s.step_order AS current_step,
        s.label AS current_step_label,
        s.action_type AS current_step_action,
        approver.full_name AS current_approver_name,
        (
          SELECT COUNT(*) FROM approval_steps
          WHERE application_id = a.id AND stage = 'RINGI'
        ) AS total_steps
      FROM applications a
      JOIN form_templates t ON a.template_id = t.id
      LEFT JOIN users u ON a.applicant_id = u.id
      JOIN approval_steps s
        ON s.application_id = a.id
        AND s.status = 'PENDING'
        AND s.stage = 'RINGI'
      LEFT JOIN users approver ON s.approver_id = approver.id
      WHERE a.status = 'PENDING_APPROVAL'
        AND ($1 = 'ADMIN' OR s.approver_id = $2 OR s.approver_id IS NULL)
      ORDER BY a.created_at DESC
    `, [role, userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[approvals] pending fetch failed:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

// POST /approvals/:id/approve — advance approval chain; issue number only on final step
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body || {};

  try {
    const result = await withTransaction(async (client) => {
      // Lock application row
      const appRow = await client.query(
        `SELECT id, status, application_number, route_id FROM applications WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (appRow.rows.length === 0) {
        const err = new Error('Application not found');
        err.status = 404;
        throw err;
      }
      if (appRow.rows[0].status !== 'PENDING_APPROVAL') {
        const err = new Error(`Cannot approve from status: ${appRow.rows[0].status}`);
        err.status = 409;
        throw err;
      }

      // Find current PENDING step (lowest step_order)
      const currentStepRes = await client.query(
        `SELECT id, step_order FROM approval_steps
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'
         ORDER BY step_order ASC
         LIMIT 1`,
        [id],
      );
      if (currentStepRes.rows.length === 0) {
        const err = new Error('No pending approval step found — data inconsistency');
        err.status = 409;
        throw err;
      }
      const currentStep = currentStepRes.rows[0];

      // Mark current step APPROVED
      await client.query(
        `UPDATE approval_steps
         SET status = 'APPROVED', comment = $2, acted_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [currentStep.id, comment || null],
      );

      // Find next WAITING step
      const nextStepRes = await client.query(
        `SELECT id, step_order FROM approval_steps
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'WAITING'
         ORDER BY step_order ASC
         LIMIT 1`,
        [id],
      );

      let updatedApp;

      if (nextStepRes.rows.length > 0) {
        // More steps remain — activate next step, application stays PENDING_APPROVAL
        await client.query(
          `UPDATE approval_steps SET status = 'PENDING' WHERE id = $1`,
          [nextStepRes.rows[0].id],
        );

        const appRes = await client.query(
          `SELECT id, status, application_number FROM applications WHERE id = $1`,
          [id],
        );
        updatedApp = { ...appRes.rows[0], advanced_to_step: nextStepRes.rows[0].step_order };
      } else {
        // Final step — issue application number, mark APPROVED
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
        [id, JSON.stringify({ step: currentStep.step_order, comment: comment || null })],
      );

      return updatedApp;
    });

    const isFinal = result.status === 'APPROVED';
    res.json({
      message: isFinal ? '最終承認しました — 申請番号を発行しました' : '承認しました — 次の承認者に送付しました',
      application: result,
      final: isFinal,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[approvals] approve failed:', err);
    res.status(500).json({ error: '承認処理に失敗しました' });
  }
});

// POST /approvals/:id/return — return to applicant; marks current step + application
router.post('/:id/return', async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body || {};
  try {
    await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE applications SET status = 'RETURNED' WHERE id = $1 AND status = 'PENDING_APPROVAL'
         RETURNING id`,
        [id],
      );
      if (r.rows.length === 0) {
        const err = new Error('差し戻しできない状態です');
        err.status = 409;
        throw err;
      }
      // Mark current PENDING step as RETURNED
      await client.query(
        `UPDATE approval_steps
         SET status = 'RETURNED', comment = $2, acted_at = CURRENT_TIMESTAMP
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'`,
        [id, comment || null],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_RETURN', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ comment: comment || null })],
      );
    });
    res.json({ message: '差し戻しました' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[approvals] return failed:', err);
    res.status(500).json({ error: '差し戻し処理に失敗しました' });
  }
});

// POST /approvals/:id/reject
router.post('/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body || {};
  try {
    await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE applications SET status = 'REJECTED' WHERE id = $1 AND status = 'PENDING_APPROVAL'
         RETURNING id`,
        [id],
      );
      if (r.rows.length === 0) {
        const err = new Error('却下できない状態です');
        err.status = 409;
        throw err;
      }
      await client.query(
        `UPDATE approval_steps
         SET status = 'REJECTED', comment = $2, acted_at = CURRENT_TIMESTAMP
         WHERE application_id = $1 AND stage = 'RINGI' AND status = 'PENDING'`,
        [id, comment || null],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPROVAL_REJECT', 'application', $1, $2::jsonb)`,
        [id, JSON.stringify({ comment: comment || null })],
      );
    });
    res.json({ message: '却下しました' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[approvals] reject failed:', err);
    res.status(500).json({ error: '却下処理に失敗しました' });
  }
});

export default router;
