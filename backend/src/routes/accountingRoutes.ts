import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { query, withTransaction } from '../config/db';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';
import { canRoleSettle } from '../services/rolePermissionsCache';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { addCsvExportJob, getCsvExportMeta } from '../services/csvExportQueue';
import { decodeCursor, encodeCursor, parsePageLimit } from '../services/pagination';
import type pg from 'pg';
import multer from 'multer';

const router = Router();
router.use(requireAuth);

// Dynamic settle guard — reads can_settle from role_permissions table (Redis-cached, 60s TTL).
// Admin flag (is_admin) always passes. No hardcoded role list.
async function requireAccounting(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role    = req.user?.role    ?? '';
  const isAdmin = isAdminUser(req.user);
  try {
    const allowed = await canRoleSettle(role, isAdmin);
    if (!allowed) {
      res.status(403).json({ error: 'この機能は精算管理権限を持つユーザーのみ利用できます' });
      return;
    }
    next();
  } catch (err) {
    // DB/Redis failure — fall back to admin-only to avoid silently opening access
    if (isAdmin) { next(); return; }
    res.status(403).json({ error: 'この機能は精算管理権限を持つユーザーのみ利用できます' });
  }
}
router.use(requireAccounting);

// ── File upload (transfer proof) ──────────────────────────────────────────────
// Memory storage so we can either:
//   (a) push to Google Drive when service account is configured, or
//   (b) write to local FS as a fallback.
// Either way the file is served via the auth-gated /api/files/:id route, so
// no public /uploads mount is needed.
import { isDriveEnabled, uploadToDrive } from '../services/driveService';

const PROOF_UPLOADS_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(PROOF_UPLOADS_DIR, { recursive: true });

const proofUpload = multer({
  storage: multer.memoryStorage(),
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

function safeProofName(original: string): string {
  const ts = Date.now();
  const safe = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `proof_${ts}_${safe}`;
}

// ── GET /accounting/settlements  (paginated, server-side filter)
// ?filter=ALL|PENDING|DONE  &date_from=YYYY-MM-DD  &date_to=YYYY-MM-DD  &limit=25
// date_from/date_to filter on COALESCE(a.settlement_submitted_at, s.created_at)
// to match the date shown in the UI.
const SETTLE_PAGE_SIZE = 25;
router.get('/settlements', async (req: Request, res: Response): Promise<void> => {
  const filter   = ((req.query.filter as string | undefined) ?? 'ALL').toUpperCase();
  const dateFrom = (req.query.date_from as string | undefined) || null;
  const dateTo   = (req.query.date_to   as string | undefined) || null;
  const limit    = parsePageLimit(req.query.limit, SETTLE_PAGE_SIZE, 100);
  const offset   = Math.max(Number(req.query.offset ?? 0), 0);
  const cursor   = decodeCursor(req.query.cursor);
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
       WHERE (($1 = 'ALL'     AND a.status IN ('SETTLEMENT_APPROVED', 'COMPLETED'))
          OR ($1 = 'PENDING' AND a.status = 'SETTLEMENT_APPROVED')
          OR ($1 = 'DONE'    AND a.status = 'COMPLETED'))
         AND a.archived_at IS NULL
         -- date range filter on display date (settlement submitted or settlement created)
         AND ($6::date IS NULL OR COALESCE(a.settlement_submitted_at, s.created_at)::date >= $6::date)
         AND ($7::date IS NULL OR COALESCE(a.settlement_submitted_at, s.created_at)::date <= $7::date)
         AND (
           $2::timestamptz IS NULL
           OR (s.created_at, s.id) < ($2::timestamptz, $3::uuid)
         )
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT $4 OFFSET $5`,
      [filter, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1, cursor ? 0 : offset, dateFrom, dateTo],
    );
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const items = rows.map((r: any) => ({
      ...r,
      can_close:   r.app_status === 'SETTLEMENT_APPROVED',
      can_approve: false,   // legacy — no longer used in UI
    }));
    res.json({
      items,
      hasMore,
      offset,
      nextCursor: hasMore
        ? encodeCursor({ created_at: rows[rows.length - 1].created_at, id: rows[rows.length - 1].settlement_id })
        : null,
    });
  } catch (err) {
    console.error('[accounting] settlements list failed:', err);
    res.status(500).json({ error: '精算一覧の取得に失敗しました' });
  }
});

// REMOVED: POST /accounting/settlements/:id/approve
// Old code-path bypassed transfer_date + proof checks. All settlement
// finalisation must now go via /close (which enforces both). Workflow-step
// approvals happen via the normal /api/approvals/:id/approve flow on the
// Approvals page; accounting only does the final close.

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
    // Wrap in tx so settlement UPDATE + outbox insert commit atomically.
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const r = await client.query(
        `UPDATE settlements
         SET ${setClauses.join(', ')}
         WHERE id = $${idx}
         RETURNING id, application_id, transfer_date, accounting_note, processed_at`,
        values,
      );
      if (r.rows.length === 0) {
        throw Object.assign(new Error('精算記録が見つかりません'), { status: 404 });
      }
      const row = r.rows[0] as { application_id: string };
      const recipients = await computeApplicationRecipients(client, row.application_id, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'SETTLEMENT_ACTION',
        entity_type:        'application',
        entity_id:          row.application_id,
        recipient_user_ids: recipients,
        payload:            { type: 'update', applicationId: row.application_id },
      });
      return r.rows[0];
    });
    res.json({ settlement: result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
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

    try {
      // Store file: Drive when configured, else local FS. Either way, the
      // resulting URL is auth-gated /api/files/<id> so admins + the applicant
      // can later view it from the AdminAppDetailModal or settlement page.
      let stored_path  = '';
      let drive_file_id: string | null = null;
      let drive_url:     string | null = null;

      if (isDriveEnabled()) {
        const r = await uploadToDrive(file.originalname, file.mimetype, file.buffer, 'receipts');
        drive_file_id = r.fileId;
        drive_url     = r.webViewLink;
        stored_path   = `drive:${r.fileId}`;
      } else {
        stored_path = safeProofName(file.originalname);
        fs.writeFileSync(path.join(PROOF_UPLOADS_DIR, stored_path), file.buffer);
      }

      let fileUrl = '';
      await withTransaction(async (client: pg.PoolClient) => {
        // Find the settlement's application so we can link the file to it
        const settle = await client.query(
          `SELECT application_id FROM settlements WHERE id = $1`,
          [req.params.id],
        );
        if (settle.rows.length === 0) {
          throw Object.assign(new Error('精算記録が見つかりません'), { status: 404 });
        }
        const applicationId = settle.rows[0].application_id as string;

        // Insert uploaded_files row so the auth-gated /api/files/:id route
        // can serve it (Drive redirect or local FS stream).
        const fileRow = await client.query(
          `INSERT INTO uploaded_files
             (application_id, uploader_id, field_name, original_name,
              stored_path, file_size, mime_type, drive_url, drive_file_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            applicationId,
            req.user!.id,
            'transfer_proof',
            file.originalname,
            stored_path,
            file.size,
            file.mimetype,
            drive_url,
            drive_file_id,
          ],
        );
        fileUrl = `/api/files/${fileRow.rows[0].id}`;

        // Save URL on settlement
        const r = await client.query(
          `UPDATE settlements
           SET transfer_proof_url = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING id, application_id, transfer_proof_url`,
          [fileUrl, req.params.id],
        );
        const proofRow = r.rows[0] as { application_id: string };

        const recipients = await computeApplicationRecipients(client, proofRow.application_id, { includeAccounting: true });
        await insertOutboxEvent(client, {
          event_type:         'SETTLEMENT_ACTION',
          entity_type:        'application',
          entity_id:          proofRow.application_id,
          recipient_user_ids: recipients,
          payload:            { type: 'proof_uploaded', applicationId: proofRow.application_id },
        });
      });
      res.json({ transfer_proof_url: fileUrl });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status) { res.status(e.status).json({ error: e.message }); return; }
      console.error('[accounting] transfer-proof upload failed:', err);
      res.status(500).json({ error: '振込証明のアップロードに失敗しました' });
    }
  },
);

// ── POST /accounting/settlements/:id/close ────────────────────────────────────
// Phase 2 closure: settlement workflow already done (SETTLEMENT_APPROVED),
// accounting user confirms transfer_date + proof then marks COMPLETED.
router.post('/settlements/:id/close', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock + validate
      const sRow = await client.query(
        `SELECT s.id, s.transfer_date, s.transfer_proof_url, a.id AS application_id, a.status
         FROM settlements s
         JOIN applications a ON a.id = s.application_id
         WHERE s.id = $1 FOR UPDATE`,
        [id],
      );
      if (sRow.rows.length === 0) {
        throw Object.assign(new Error('精算記録が見つかりません'), { status: 404 });
      }
      const row = sRow.rows[0] as {
        id: string; transfer_date: string | null; transfer_proof_url: string | null;
        application_id: string; status: string;
      };

      if (row.status !== 'SETTLEMENT_APPROVED') {
        throw Object.assign(
          new Error(`承認が完了していないため精算を締めることができません (現在: ${row.status})`),
          { status: 409 },
        );
      }
      if (!row.transfer_date) {
        throw Object.assign(new Error('振込日を入力してから締めてください'), { status: 422 });
      }
      if (!row.transfer_proof_url) {
        throw Object.assign(new Error('振込証明をアップロードしてから締めてください'), { status: 422 });
      }

      // Mark application COMPLETED
      await client.query(
        `UPDATE applications SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.application_id],
      );
      // Mark settlement PROCESSED
      await client.query(
        `UPDATE settlements
         SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, processed_by = $2
         WHERE id = $1`,
        [id, req.user!.id],
      );
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('ACCOUNTING_CLOSE', 'application', $1, $2::jsonb)`,
        [row.application_id, JSON.stringify({ actor: req.user!.id })],
      );

      const recipients = await computeApplicationRecipients(client, row.application_id, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPROVAL_ACTION',
        entity_type:        'application',
        entity_id:          row.application_id,
        recipient_user_ids: recipients,
        payload:            { type: 'accounting_close', applicationId: row.application_id },
      });

      return { application_id: row.application_id };
    });
    res.json({ message: '精算を完了しました — 申請が完了状態になりました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[accounting] close failed:', err);
    res.status(500).json({ error: '精算の完了処理に失敗しました' });
  }
});

// ── CSV export — async via BullMQ worker ─────────────────────────────────────
//
// Why async? Sync CSV blocks the event loop and OOMs on big result sets.
// New flow:
//   1. POST /accounting/settlements/csv/export   → enqueue, return { jobId }
//   2. GET  /accounting/settlements/csv/:jobId   → poll status
//   3. GET  /accounting/settlements/csv/:jobId/download → stream file when ready
//
// Backward-compat: GET /accounting/settlements/csv (no jobId) still works,
// but now redirects to the async flow internally for any size.

// POST /accounting/settlements/csv/export — enqueue export job
router.post('/settlements/csv/export', async (req: Request, res: Response): Promise<void> => {
  const { ids, selectAll, dateFrom, dateTo } = req.body as {
    ids?: string[];
    selectAll?: boolean;
    dateFrom?: string;
    dateTo?: string;
  };
  try {
    const jobId = await addCsvExportJob({
      userId:    req.user!.id,
      ids:       Array.isArray(ids) && ids.length > 0 ? ids : undefined,
      selectAll: selectAll === true,
      dateFrom:  typeof dateFrom === 'string' && dateFrom ? dateFrom : undefined,
      dateTo:    typeof dateTo   === 'string' && dateTo   ? dateTo   : undefined,
    });
    res.status(202).json({ jobId, status: 'queued' });
  } catch (err) {
    console.error('[accounting] CSV enqueue failed:', err);
    res.status(500).json({ error: 'エクスポートのキューイングに失敗しました' });
  }
});

// GET /accounting/settlements/csv/:jobId — status poll
router.get('/settlements/csv/:jobId', async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;
  try {
    const meta = await getCsvExportMeta(String(jobId));
    if (!meta) { res.status(404).json({ error: 'ジョブが見つかりません' }); return; }
    if (meta.userId !== req.user!.id && !isAdminUser(req.user)) {
      res.status(403).json({ error: 'このジョブにアクセスする権限がありません' });
      return;
    }
    res.json({
      jobId,
      status:    meta.status,
      rowCount:  meta.rowCount,
      error:     meta.error,
      createdAt: meta.createdAt,
      finishedAt: meta.finishedAt,
    });
  } catch (err) {
    console.error('[accounting] CSV status failed:', err);
    res.status(500).json({ error: 'ステータス取得に失敗しました' });
  }
});

// GET /accounting/settlements/csv/:jobId/download — stream the CSV file
router.get('/settlements/csv/:jobId/download', async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;
  try {
    const meta = await getCsvExportMeta(String(jobId));
    if (!meta) { res.status(404).json({ error: 'ジョブが見つかりません' }); return; }
    if (meta.userId !== req.user!.id && !isAdminUser(req.user)) {
      res.status(403).json({ error: 'このジョブにアクセスする権限がありません' });
      return;
    }
    if (meta.status !== 'ready' || !meta.filename) {
      res.status(409).json({ error: 'ファイルはまだ準備できていません', status: meta.status });
      return;
    }

    const exportsDir = path.join(__dirname, '../../exports');
    const filepath   = path.join(exportsDir, meta.filename);

    // Path-traversal guard — meta.filename should never contain ".." but defend in depth
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(exportsDir))) {
      res.status(400).json({ error: 'invalid path' }); return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'ファイルが見つかりません（期限切れの可能性）' }); return;
    }

    const downloadName = `settlements_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error('[accounting] CSV download failed:', err);
    res.status(500).json({ error: 'ダウンロードに失敗しました' });
  }
});

// LEGACY: GET /accounting/settlements/csv — kept so existing frontend doesn't 404.
// Returns 410 Gone with hint to use new async flow. Update frontend to call
// POST /export then poll, then GET /download.
router.get('/settlements/csv', async (_req: Request, res: Response): Promise<void> => {
  res.status(410).json({
    error:  'この同期エンドポイントは廃止されました。POST /accounting/settlements/csv/export を使用してください。',
    hint:   'See accountingRoutes.ts header comment for the new flow.',
  });
});

export default router;
