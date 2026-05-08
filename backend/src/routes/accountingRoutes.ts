import { Router, Request, Response, NextFunction } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { emitAll } from './sseRoutes';
import type pg from 'pg';
import multer from 'multer';
import path from 'path';

const router = Router();
router.use(requireAuth);

// Only ACCOUNTING, SOUMU, ADMIN can access
function requireAccounting(req: Request, res: Response, next: NextFunction): void {
  const role = req.user?.role ?? '';
  if (!['ACCOUNTING', 'SOUMU', 'ADMIN'].includes(role)) {
    res.status(403).json({ error: 'この機能は経理・総務・管理者のみ利用できます' });
    return;
  }
  next();
}
router.use(requireAccounting);

// ── File upload (transfer proof) ──────────────────────────────────────────────
const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `proof_${ts}_${safe}`);
  },
});
const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`対応していないファイル形式: ${file.mimetype}`));
  },
});

// ── GET /accounting/settlements ───────────────────────────────────────────────
router.get('/settlements', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  try {
    const result = await query(
      `SELECT
         s.id            AS settlement_id,
         s.expected_amount,
         s.actual_amount,
         s.currency,
         s.status        AS settlement_status,
         s.transfer_date,
         s.transfer_proof_url,
         s.accounting_note,
         s.processed_at,
         s.created_at,
         a.id            AS application_id,
         a.application_number,
         a.status        AS app_status,
         a.settlement_submitted_at,
         a.completed_at,
         ft.title_ja     AS template_name,
         u.full_name     AS applicant_name,
         d.name          AS department_name,
         -- current pending settlement step (for inline approval)
         pending_step.id                  AS pending_step_id,
         pending_step.approver_id         AS pending_approver_id,
         pending_step.label               AS pending_step_label,
         pending_approver.full_name       AS pending_approver_name
       FROM settlements s
       JOIN applications a  ON a.id = s.application_id
       JOIN form_templates ft ON ft.id = a.template_id
       JOIN users u         ON u.id = a.applicant_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN LATERAL (
         SELECT id, approver_id, label
         FROM approval_steps
         WHERE application_id = a.id AND stage = 'SETTLEMENT' AND status = 'PENDING'
         ORDER BY step_order ASC LIMIT 1
       ) pending_step ON TRUE
       LEFT JOIN users pending_approver ON pending_approver.id = pending_step.approver_id
       ORDER BY s.created_at DESC`,
    );
    // Annotate whether current user can approve this step
    const rows = result.rows.map((r: any) => ({
      ...r,
      can_approve: r.pending_step_id != null && (
        r.pending_approver_id === userId ||
        req.user!.role === 'ADMIN'
      ),
    }));
    res.json(rows);
  } catch (err) {
    console.error('[accounting] settlements list failed:', err);
    res.status(500).json({ error: '精算一覧の取得に失敗しました' });
  }
});

// ── POST /accounting/settlements/:id/approve ──────────────────────────────────
// Quick-approve the current pending SETTLEMENT step from the accounting page
router.post('/settlements/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const { comment } = req.body as { comment?: string };
  const userId = req.user!.id;
  const role   = req.user!.role;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Find the pending step for this settlement
      const stepRes = await client.query(
        `SELECT st.id, st.step_order, st.approver_id, st.stage, a.id AS application_id, a.status
         FROM settlements s
         JOIN applications a ON a.id = s.application_id
         JOIN approval_steps st
           ON st.application_id = a.id AND st.stage = 'SETTLEMENT' AND st.status = 'PENDING'
         WHERE s.id = $1
         ORDER BY st.step_order ASC LIMIT 1`,
        [req.params.id],
      );
      if (stepRes.rows.length === 0) {
        throw Object.assign(new Error('承認待ちステップが見つかりません'), { status: 404 });
      }
      const step = stepRes.rows[0] as {
        id: string; step_order: number; approver_id: string | null;
        stage: string; application_id: string; status: string;
      };

      // Auth check
      if (role !== 'ADMIN' && step.approver_id && step.approver_id !== userId) {
        throw Object.assign(new Error('このステップの承認権限がありません'), { status: 403 });
      }

      // Approve this step
      await client.query(
        `UPDATE approval_steps
         SET status = 'APPROVED', comment = $2, acted_at = CURRENT_TIMESTAMP, acted_by = $3
         WHERE id = $1`,
        [step.id, comment ?? null, userId],
      );

      // Advance to next or finalise
      const nextRes = await client.query(
        `SELECT id FROM approval_steps
         WHERE application_id = $1 AND stage = 'SETTLEMENT' AND status = 'WAITING'
         ORDER BY step_order ASC LIMIT 1`,
        [step.application_id],
      );

      let newStatus: string;
      if (nextRes.rows.length > 0) {
        await client.query(`UPDATE approval_steps SET status = 'PENDING' WHERE id = $1`, [nextRes.rows[0].id]);
        newStatus = 'PENDING_SETTLEMENT'; // still in progress
      } else {
        // Final step — complete
        const seqRow = await client.query(`SELECT nextval('application_number_seq') AS n`);
        const year   = new Date().getFullYear();
        const appNum = `RNG-${year}-${String(seqRow.rows[0].n).padStart(6, '0')}`;
        await client.query(
          `UPDATE applications
           SET status = 'COMPLETED',
               application_number = COALESCE(application_number, $2),
               completed_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [step.application_id, appNum],
        );
        await client.query(
          `UPDATE settlements SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE application_id = $1`,
          [step.application_id, userId],
        );
        newStatus = 'COMPLETED';
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id)
         VALUES ('ACCOUNTING_APPROVE', 'application', $1)`,
        [step.application_id],
      );

      return { application_id: step.application_id, new_status: newStatus };
    });

    const appId = (result as { application_id: string }).application_id;
    emitAll('APPROVAL_ACTION', { type: 'accounting_approve', applicationId: appId });
    res.json({ message: '承認しました', result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[accounting] approve failed:', err);
    res.status(500).json({ error: '承認処理に失敗しました' });
  }
});

// ── PATCH /accounting/settlements/:id ────────────────────────────────────────
router.patch('/settlements/:id', async (req: Request, res: Response): Promise<void> => {
  const { transfer_date, accounting_note } = req.body as {
    transfer_date?: string | null;
    accounting_note?: string;
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (transfer_date !== undefined) {
    setClauses.push(`transfer_date = $${idx++}`);
    values.push(transfer_date || null);
  }
  if (accounting_note !== undefined) {
    setClauses.push(`accounting_note = $${idx++}`);
    values.push(accounting_note);
  }
  if (setClauses.length === 0) {
    res.status(400).json({ error: '更新するフィールドがありません' });
    return;
  }

  setClauses.push(
    `processed_by = $${idx++}`,
    `processed_at = CURRENT_TIMESTAMP`,
    `updated_at   = CURRENT_TIMESTAMP`,
  );
  values.push(req.user!.id);
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE settlements
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING id, application_id, transfer_date, accounting_note, processed_at`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: '精算記録が見つかりません' });
      return;
    }
    const row = result.rows[0] as { application_id: string };
    emitAll('SETTLEMENT_ACTION', { type: 'update', applicationId: row.application_id });
    res.json({ settlement: result.rows[0] });
  } catch (err) {
    console.error('[accounting] settlement patch failed:', err);
    res.status(500).json({ error: '精算の更新に失敗しました' });
  }
});

// ── POST /accounting/settlements/:id/transfer-proof ───────────────────────────
router.post(
  '/settlements/:id/transfer-proof',
  proofUpload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'ファイルが必要です' });
      return;
    }

    const fileUrl = `/uploads/${file.filename}`;
    try {
      const result = await query(
        `UPDATE settlements
         SET transfer_proof_url = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, application_id, transfer_proof_url`,
        [fileUrl, req.params.id],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: '精算記録が見つかりません' });
        return;
      }
      const proofRow = result.rows[0] as { application_id: string };
      emitAll('SETTLEMENT_ACTION', { type: 'proof_uploaded', applicationId: proofRow.application_id });
      res.json({ transfer_proof_url: fileUrl });
    } catch (err) {
      console.error('[accounting] transfer-proof upload failed:', err);
      res.status(500).json({ error: '振込証明のアップロードに失敗しました' });
    }
  },
);

// ── GET /accounting/settlements/csv?ids=uuid1,uuid2,... ──────────────────────
// Must be registered BEFORE the /:id route to avoid uuid-parsing the string "csv"
router.get('/settlements/csv', async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.query as { ids?: string };

  try {
    let rows: Record<string, unknown>[];

    if (ids && ids.trim()) {
      const idList = ids.split(',').map((id) => id.trim()).filter(Boolean);
      const result = await query(
        `SELECT
           a.application_number,
           u.full_name     AS applicant,
           d.name          AS department,
           ft.title_ja     AS form_type,
           s.expected_amount,
           s.actual_amount,
           s.transfer_date,
           s.accounting_note,
           s.settlement_status,
           s.created_at
         FROM (
           SELECT s.*, a.status AS app_status, s.status AS settlement_status
           FROM settlements s
           JOIN applications a ON a.id = s.application_id
           WHERE s.id = ANY($1::uuid[])
         ) s
         JOIN applications a  ON a.id = s.application_id
         JOIN form_templates ft ON ft.id = a.template_id
         JOIN users u         ON u.id = a.applicant_id
         LEFT JOIN departments d ON d.id = u.department_id
         ORDER BY s.created_at DESC`,
        [idList],
      );
      rows = result.rows;
    } else {
      const result = await query(
        `SELECT
           a.application_number,
           u.full_name     AS applicant,
           d.name          AS department,
           ft.title_ja     AS form_type,
           s.expected_amount,
           s.actual_amount,
           s.transfer_date,
           s.accounting_note,
           s.status        AS settlement_status,
           s.created_at
         FROM settlements s
         JOIN applications a  ON a.id = s.application_id
         JOIN form_templates ft ON ft.id = a.template_id
         JOIN users u         ON u.id = a.applicant_id
         LEFT JOIN departments d ON d.id = u.department_id
         ORDER BY s.created_at DESC`,
      );
      rows = result.rows;
    }

    // Build CSV with BOM for Excel
    const headers = [
      '申請番号', '申請者', '部署', '申請種別',
      '概算金額（円）', '実費合計（円）',
      '振込日', '備考', 'ステータス', '作成日',
    ];

    const escape = (v: unknown) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const lines = [
      headers.join(','),
      ...rows.map((r) => [
        escape(r.application_number),
        escape(r.applicant),
        escape(r.department),
        escape(r.form_type),
        r.expected_amount ?? 0,
        r.actual_amount ?? 0,
        r.transfer_date ? new Date(r.transfer_date as string).toLocaleDateString('ja-JP') : '',
        escape(r.accounting_note),
        escape(r.settlement_status),
        new Date(r.created_at as string).toLocaleDateString('ja-JP'),
      ].join(',')),
    ];

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="settlements_${timestamp}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    console.error('[accounting] CSV export failed:', err);
    res.status(500).json({ error: 'CSVエクスポートに失敗しました' });
  }
});

export default router;
