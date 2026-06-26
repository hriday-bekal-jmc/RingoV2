import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../../config/db';
import { insertOutboxEvent } from '../../services/eventOutbox';
import { computeApplicationRecipients } from '../../services/eventRecipients';
import { redis } from '../../config/redis';
import { decodeCursor, encodeCursor, parsePageLimit } from '../../services/pagination';
import type pg from 'pg';

const router = Router();

const ARCHIVABLE_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

// ─── Applications ─────────────────────────────────────────────────────────────

router.get('/applications', async (req: Request, res: Response): Promise<void> => {
  const search = ((req.query.search as string | undefined) ?? '').trim();
  const dept   = ((req.query.dept   as string | undefined) ?? '').trim();
  const status = ((req.query.status as string | undefined) ?? '').trim().toUpperCase();
  const archive = ((req.query.archive as string | undefined) ?? 'active').trim().toLowerCase();
  const limit  = parsePageLimit(req.query.limit, 30, 200);
  const offset = Math.max(Number(req.query.offset ?? 0),  0);
  const cursor = decodeCursor(req.query.cursor);

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(
        u.full_name ILIKE $${idx} OR
        t.title_ja ILIKE $${idx} OR
        a.application_number ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx++;
    }
    if (dept) {
      conditions.push(`d.name = $${idx++}`);
      params.push(dept);
    }
    if (status) {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }
    if (archive === 'archived') {
      conditions.push('a.archived_at IS NOT NULL');
    } else if (archive !== 'all') {
      conditions.push('a.archived_at IS NULL');
    }
    if (cursor) {
      conditions.push(`(a.created_at, a.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
      params.push(cursor.created_at, cursor.id);
    }
    params.push(limit + 1);
    const limitIdx = idx++;
    params.push(cursor ? 0 : offset);
    const offsetIdx = idx++;
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT a.id, a.application_number, a.status, a.created_at,
              a.archived_at, a.archive_reason,
              t.title_ja AS template_name,
              t.settlement_schema IS NOT NULL AS has_settlement,
              u.full_name AS applicant_name,
              u.email AS applicant_email,
              d.name AS department_name
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       LEFT JOIN departments d ON d.id = u.department_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({
      items: rows,
      hasMore,
      offset,
      nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
    });
  } catch (err) {
    console.error('[admin] applications list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

router.get('/applications/:id', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  try {
    const [appRes, stepsRes, filesRes, auditRes, settleRes] = await Promise.all([
      query(
        `SELECT
           a.id, a.application_number, a.status, a.version,
           a.form_data, a.settlement_data,
           a.template_id, a.template_version_id, a.route_id, a.applicant_id,
           a.created_at, a.submitted_at, a.settlement_submitted_at, a.completed_at, a.updated_at,
           a.archived_at, a.archived_by, a.archive_reason,
           t.code AS template_code, t.title_ja AS template_name,
           COALESCE(v.schema_definition, t.schema_definition) AS schema_definition,
           COALESCE(v.settlement_schema, t.settlement_schema) AS settlement_schema,
           v.version_number AS template_version_number,
           t.settlement_schema IS NOT NULL AS has_settlement,
           t.pattern_id, t.component_type,
           u.full_name AS applicant_name, u.email AS applicant_email, u.avatar_url AS applicant_avatar,
           d.name AS department_name, d.id AS department_id
         FROM applications a
         JOIN form_templates t ON t.id = a.template_id
         LEFT JOIN form_template_versions v ON v.id = a.template_version_id
         LEFT JOIN users u ON u.id = a.applicant_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE a.id = $1`,
        [id],
      ),
      query(
        `SELECT
           s.id, s.step_order, s.stage, s.label, s.action_type, s.status,
           s.comment, s.acted_at, s.acted_by, s.created_at,
           u.full_name AS approver_name, u.email AS approver_email, u.avatar_url AS approver_avatar,
           act.full_name AS acted_by_name
         FROM approval_steps s
         LEFT JOIN users u   ON u.id   = s.approver_id
         LEFT JOIN users act ON act.id = s.acted_by
         WHERE s.application_id = $1
         ORDER BY s.stage ASC NULLS FIRST, s.step_order ASC`,
        [id],
      ),
      query(
        `SELECT id, field_name, original_name, file_size, mime_type, drive_url, created_at,
                uploader_id, stored_path
         FROM uploaded_files
         WHERE application_id = $1
         ORDER BY created_at ASC`,
        [id],
      ),
      query(
        `SELECT id, action, entity_type, entity_id, metadata, created_at
         FROM audit_logs
         WHERE entity_type = 'application' AND entity_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [id],
      ),
      query(
        `SELECT s.id, s.expected_amount, s.actual_amount, s.status,
                s.transfer_date, s.transfer_proof_url, s.accounting_note,
                s.processed_at, s.processed_by, s.settlement_data,
                s.created_at, s.updated_at,
                proc.full_name AS processed_by_name
         FROM settlements s
         LEFT JOIN users proc ON proc.id = s.processed_by
         WHERE s.application_id = $1
         LIMIT 1`,
        [id],
      ),
    ]);

    if (appRes.rows.length === 0) {
      res.status(404).json({ error: '申請が見つかりません' });
      return;
    }

    res.json({
      application: appRes.rows[0],
      steps:       stepsRes.rows,
      files:       filesRes.rows,
      audit_logs:  auditRes.rows,
      settlement:  settleRes.rows[0] ?? null,
    });
  } catch (err) {
    console.error('[admin] application detail failed:', err);
    res.status(500).json({ error: '申請詳細の取得に失敗しました' });
  }
});

router.post('/applications/:id/archive', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const reasonRaw = (req.body as { reason?: string } | undefined)?.reason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : null;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const appRes = await client.query(
        `SELECT id, status, archived_at FROM applications WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('申請が見つかりません'), { status: 404 });
      }

      const app = appRes.rows[0] as { id: string; status: string; archived_at: Date | null };
      if (app.archived_at) {
        const recipients = await computeApplicationRecipients(client, id, { includeAccounting: true });
        return {
          application: { id, archived_at: app.archived_at, already_archived: true },
          recipients,
        };
      }
      if (!ARCHIVABLE_STATUSES.has(app.status)) {
        throw Object.assign(
          new Error(`完了・却下・キャンセル済みの申請のみアーカイブできます (現在: ${app.status})`),
          { status: 409 },
        );
      }

      const archived = await client.query(
        `UPDATE applications
         SET archived_at = NOW(),
             archived_by = $2,
             archive_reason = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, archived_at, archive_reason`,
        [id, req.user!.id, reason],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'APPLICATION_ARCHIVE', 'application', $2, $3::jsonb)`,
        [req.user!.id, id, JSON.stringify({ reason })],
      );

      const recipients = await computeApplicationRecipients(client, id, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          id,
        recipient_user_ids: recipients,
        payload:            { type: 'archive', applicationId: id },
      });

      return { application: archived.rows[0], recipients };
    });

    const dashboardKeys = [
      'dashboard:admin-overview',
      ...result.recipients.map((uid) => `dashboard:summary:${uid}`),
    ];
    await redis.del(...dashboardKeys).catch(() => {});
    res.json({ application: result.application });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin] application archive failed:', err);
    res.status(500).json({ error: '申請のアーカイブに失敗しました' });
  }
});

router.post('/applications/:id/unarchive', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const appRes = await client.query(
        `UPDATE applications
         SET archived_at = NULL,
             archived_by = NULL,
             archive_reason = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND archived_at IS NOT NULL
         RETURNING id`,
        [id],
      );
      if (appRes.rows.length === 0) {
        throw Object.assign(new Error('アーカイブ済み申請が見つかりません'), { status: 404 });
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
         VALUES ($1, 'APPLICATION_UNARCHIVE', 'application', $2)`,
        [req.user!.id, id],
      );

      const recipients = await computeApplicationRecipients(client, id, { includeAccounting: true });
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          id,
        recipient_user_ids: recipients,
        payload:            { type: 'unarchive', applicationId: id },
      });

      return { application: appRes.rows[0], recipients };
    });

    const dashboardKeys = [
      'dashboard:admin-overview',
      ...result.recipients.map((uid) => `dashboard:summary:${uid}`),
    ];
    await redis.del(...dashboardKeys).catch(() => {});
    res.json({ application: result.application });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin] application unarchive failed:', err);
    res.status(500).json({ error: '申請のアーカイブ解除に失敗しました' });
  }
});

router.delete('/applications/:id', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  try {
    if (req.query.hard !== 'true') {
      res.status(405).json({ error: '物理削除は無効です。/archive を使用してください。' });
      return;
    }

    const confirm = String(req.query.confirm ?? '');
    const appRes = await query(
      `SELECT id, application_number, archived_at FROM applications WHERE id = $1`,
      [id],
    );
    if (appRes.rows.length === 0) {
      res.status(404).json({ error: '申請が見つかりません' });
      return;
    }
    const app = appRes.rows[0] as { id: string; application_number: string | null; archived_at: Date | null };
    if (confirm !== app.id && confirm !== app.application_number) {
      res.status(400).json({ error: 'confirm に申請IDまたは申請番号を指定してください' });
      return;
    }

    const result = await withTransaction(async (client: pg.PoolClient) => {
      const lockedRes = await client.query(
        `SELECT id, application_number, archived_at FROM applications WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (lockedRes.rows.length === 0) {
        throw Object.assign(new Error('Application not found'), { status: 404 });
      }
      const lockedApp = lockedRes.rows[0] as { id: string; application_number: string | null; archived_at: Date | null };
      if (confirm !== lockedApp.id && confirm !== lockedApp.application_number) {
        throw Object.assign(new Error('confirm must match application id or application number'), { status: 400 });
      }

      const recipients = await computeApplicationRecipients(client, id, { includeAccounting: true });
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'APPLICATION_HARD_DELETE', 'application', $2, $3::jsonb)`,
        [req.user!.id, id, JSON.stringify({ application_number: lockedApp.application_number })],
      );
      await client.query(`DELETE FROM applications WHERE id = $1`, [id]);
      await insertOutboxEvent(client, {
        event_type:         'APPLICATION_CHANGED',
        entity_type:        'application',
        entity_id:          id,
        recipient_user_ids: recipients,
        payload:            { type: 'hard_delete', applicationId: id },
      });
      return { recipients };
    });
    const dashboardKeys = [
      'dashboard:admin-overview',
      ...result.recipients.map((uid) => `dashboard:summary:${uid}`),
    ];
    await redis.del(...dashboardKeys).catch(() => {});
    res.json({ message: 'アーカイブ済み申請データを物理削除しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin] application delete failed:', err);
    res.status(500).json({ error: '申請の削除に失敗しました' });
  }
});

export default router;
