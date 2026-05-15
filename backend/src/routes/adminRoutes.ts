import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { query, withTransaction } from '../config/db';
import { requireAuth, requireAdmin, invalidateUserStateCache } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';
import { insertOutboxEvent } from '../services/eventOutbox';
import { computeApplicationRecipients } from '../services/eventRecipients';
import { redis } from '../config/redis';
import { SUPER_ADMIN_EMAILS } from '../config/env';
import { getJsonCache, setJsonCache } from '../services/cache';
import {
  ADMIN_REF_CACHE_TTL_SEC,
  adminRefCacheKey,
  invalidateAdminReferenceCache,
} from '../services/adminReferenceCache';
import { decodeCursor, encodeCursor, parsePageLimit } from '../services/pagination';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);
router.use(mutationLimiter);

const USER_ROLES = new Set(['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING']);
const isValidBusinessRole = (role: unknown): role is string =>
  typeof role === 'string' && USER_ROLES.has(role);

async function hasOtherActiveAdmin(userId: string): Promise<boolean> {
  const r = await query(
    `SELECT EXISTS (
       SELECT 1 FROM users
       WHERE id <> $1
         AND is_active = TRUE
         AND (is_admin = TRUE OR lower(email) = ANY($2::text[]))
     ) AS ok`,
    [userId, [...SUPER_ADMIN_EMAILS]],
  );
  return Boolean(r.rows[0]?.ok);
}

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`
      SELECT u.id, u.full_name, u.email, u.role,
             (u.is_admin OR lower(u.email) = ANY($1::text[])) AS is_admin,
             u.is_active, u.department_id,
             CASE WHEN u.avatar_url LIKE 'data:%' THEN NULL ELSE u.avatar_url END AS avatar_url,
             d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.created_at DESC
    `, [[...SUPER_ADMIN_EMAILS]]);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] users list failed:', err);
    res.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' });
  }
});

router.post('/users', async (req: Request, res: Response): Promise<void> => {
  const { full_name, email, role, is_admin, department_id, password, is_active } = req.body as {
    full_name: string; email: string; role: string;
    is_admin?: boolean; department_id?: string; password?: string; is_active?: boolean;
  };
  if (!isValidBusinessRole(role)) {
    res.status(400).json({ error: 'Invalid business role' });
    return;
  }
  try {
    const hash = password ? await argon2.hash(password) : null;
    await query(
      `INSERT INTO users (full_name, email, role, is_admin, department_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [full_name, email.toLowerCase().trim(), role, is_admin ?? false, department_id ?? null, hash, is_active ?? true],
    );
    void invalidateAdminReferenceCache('routes');
    res.status(201).json({ message: 'ユーザーを作成しました' });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') { res.status(409).json({ error: 'このメールアドレスは既に使用されています' }); return; }
    console.error('[admin] user create failed:', err);
    res.status(500).json({ error: 'ユーザーの作成に失敗しました' });
  }
});

router.patch('/users/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { full_name, email, role, is_admin, department_id, password, is_active } = req.body as {
    full_name?: string; email?: string; role?: string;
    is_admin?: boolean; department_id?: string | null; password?: string; is_active?: boolean;
  };
  if (role !== undefined && !isValidBusinessRole(role)) {
    res.status(400).json({ error: 'Invalid business role' });
    return;
  }

  try {
    // ─── SUPER ADMIN SAFEGUARD (スーパー管理者の保護) ───
    const targetRes = await query(`SELECT email FROM users WHERE id = $1`, [id]);
    if (targetRes.rows.length > 0) {
      const targetEmail = targetRes.rows[0].email;
      if (SUPER_ADMIN_EMAILS.has(String(targetEmail).toLowerCase())) {
        if (is_active === false) {
          res.status(403).json({ error: 'システム管理者のアカウントは無効化できません。' });
          return;
        }
        if (is_admin === false) {
          res.status(403).json({ error: 'システム管理者の権限（ロール）は変更できません。' });
          return;
        }
      }
    }
    // ────────────────────────────────────────────────

    // Detect privilege-relevant change → bump token_version to revoke old JWTs
    const beforeRes = await query(
      `SELECT full_name, email, role, is_admin, department_id, is_active FROM users WHERE id = $1`,
      [id],
    );
    const before = beforeRes.rows[0] as {
      full_name: string; email: string; role: string; is_admin: boolean;
      department_id: string | null; is_active: boolean;
    } | undefined;
    if (!before) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const roleChanged     = before && role !== undefined && before.role !== role;
    const adminChanged    = before && is_admin !== undefined && before.is_admin !== is_admin;
    const activationChanged = before && is_active !== undefined && before.is_active !== is_active;
    const passwordChanged = !!password;
    const bumpTokenVersion = roleChanged || adminChanged || activationChanged || passwordChanged;

    if (before.is_admin && (is_admin === false || is_active === false)) {
      const otherAdminExists = await hasOtherActiveAdmin(String(id));
      if (!otherAdminExists) {
        res.status(409).json({ error: 'At least one active admin is required' });
        return;
      }
    }

    const params: unknown[] = [
      full_name ?? before.full_name,
      email?.toLowerCase().trim() ?? before.email,
      role ?? before.role,
      is_admin ?? before.is_admin,
      department_id === undefined ? before.department_id : department_id ?? null,
      is_active ?? before.is_active,
    ];
    let q = `UPDATE users SET full_name=$1, email=$2, role=$3, is_admin=$4, department_id=$5, is_active=$6`;

    if (password) {
      params.push(await argon2.hash(password));
      q += `, password_hash=$${params.length}`;
    }
    if (bumpTokenVersion) {
      q += `, token_version = token_version + 1`;
    }
    q += ` WHERE id=$${params.length + 1}`;
    params.push(id);

    await query(q, params);
    await invalidateUserStateCache(String(id));
    if (bumpTokenVersion) {
      await invalidateUserStateCache(String(id));
      // Push event to the affected user's SSE channel via outbox — replaces 60s /me poll.
      // Frontend AuthContext listens and re-fetches /me on receipt.
      await withTransaction(async (client) => {
        await insertOutboxEvent(client, {
          event_type:         'user-state-changed',
          entity_type:        'user',
          entity_id:          String(id),
          recipient_user_ids: [String(id)],
          payload:            { reason: 'profile-updated' },
        });
      });
    }
    void invalidateAdminReferenceCache('routes');
    res.json({ message: 'ユーザーを更新しました' });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') { res.status(409).json({ error: 'このメールアドレスは既に使用されています' }); return; }
    console.error('[admin] user update failed:', err);
    res.status(500).json({ error: 'ユーザーの更新に失敗しました' });
  }
});

router.delete('/users/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // ─── SUPER ADMIN SAFEGUARD (スーパー管理者の保護) ───
    const targetRes = await query(`SELECT email, is_admin, is_active FROM users WHERE id = $1`, [req.params.id]);
    if (targetRes.rows.length > 0) {
      const targetEmail = targetRes.rows[0].email;
      const targetIsActiveAdmin = Boolean(targetRes.rows[0].is_admin) && Boolean(targetRes.rows[0].is_active);
      if (SUPER_ADMIN_EMAILS.has(String(targetEmail).toLowerCase())) {
        res.status(403).json({ error: 'システム管理者のアカウントは削除できません。' });
        return;
      }
      if (targetIsActiveAdmin) {
        const otherAdminExists = await hasOtherActiveAdmin(String(req.params.id));
        if (!otherAdminExists) {
          res.status(409).json({ error: 'At least one active admin is required' });
          return;
        }
      }
    }
    // ────────────────────────────────────────────────

    if (req.query.hard === 'true') {
      await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    } else {
      await query(
        `UPDATE users SET is_active = FALSE, token_version = token_version + 1 WHERE id = $1`,
        [req.params.id],
      );
    }
    await invalidateUserStateCache(String(req.params.id));
    // Push event so user's frontend immediately re-checks auth → 401 → redirect to login
    await withTransaction(async (client) => {
      await insertOutboxEvent(client, {
        event_type:         'user-state-changed',
        entity_type:        'user',
        entity_id:          String(req.params.id),
        recipient_user_ids: [String(req.params.id)],
        payload:            { reason: 'deactivated' },
      });
    });
    void invalidateAdminReferenceCache('routes');
    res.json({ message: 'ユーザーを削除/無効化しました' });
  } catch (err) {
    console.error('[admin] user delete failed:', err);
    res.status(500).json({ error: 'ユーザーの削除に失敗しました' });
  }
});

// ─── Departments & Templates ──────────────────────────────────────────────────

router.get('/departments', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = adminRefCacheKey('departments');
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    const result = await query(`SELECT id, name, code FROM departments ORDER BY created_at`);
    void setJsonCache(cacheKey, result.rows, ADMIN_REF_CACHE_TTL_SEC);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '部署一覧の取得に失敗しました' });
  }
});

router.get('/templates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = adminRefCacheKey('templates');
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    const result = await query(`SELECT id, code, title_ja FROM form_templates ORDER BY created_at`);
    void setJsonCache(cacheKey, result.rows, ADMIN_REF_CACHE_TTL_SEC);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// ─── Routes & Steps ──────────────────────────────────────────────────────────

router.get('/routes', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = adminRefCacheKey('routes');
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    const routes = await query(`
      SELECT r.id, r.name, r.stage, r.is_active, r.is_default,
             t.title_ja AS template_name, t.id AS template_id,
             d.name AS department_name, d.id AS department_id
      FROM approval_routes r
      JOIN form_templates t ON r.template_id = t.id
      JOIN departments d ON r.department_id = d.id
      ORDER BY r.created_at DESC
    `);
    const steps = await query(`
      SELECT s.id, s.route_id, s.step_order, s.label, s.action_type,
             s.approver_id, u.full_name AS approver_name,
             CASE WHEN u.avatar_url LIKE 'data:%' THEN NULL ELSE u.avatar_url END AS approver_avatar
      FROM approval_route_steps s
      LEFT JOIN users u ON s.approver_id = u.id
      ORDER BY s.route_id, s.step_order
    `);
    const stepsByRoute = steps.rows.reduce<Record<string, unknown[]>>((acc, s) => {
      const key = (s as { route_id: string }).route_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    }, {});
    const payload = routes.rows.map((r: { id: string }) => ({ ...r, steps: stepsByRoute[r.id] ?? [] }));
    void setJsonCache(cacheKey, payload, ADMIN_REF_CACHE_TTL_SEC);
    res.json(payload);
  } catch (err) {
    console.error('[admin] routes list failed:', err);
    res.status(500).json({ error: 'ルート一覧の取得に失敗しました' });
  }
});

router.post('/routes', async (req: Request, res: Response): Promise<void> => {
  const { template_id, department_id, name, stage } = req.body as {
    template_id: string; department_id: string; name: string; stage?: string;
  };
  try {
    await query(
      `INSERT INTO approval_routes (template_id, department_id, name, stage, is_active)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [template_id, department_id, name, stage ?? 'RINGI'],
    );
    void invalidateAdminReferenceCache('routes');
    res.status(201).json({ message: 'ルートを作成しました' });
  } catch (err) {
    console.error('[admin] route create failed:', err);
    res.status(500).json({ error: 'ルートの作成に失敗しました' });
  }
});

router.delete('/routes/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await query(`DELETE FROM approval_routes WHERE id = $1`, [req.params.id]);
    void invalidateAdminReferenceCache('routes');
    res.json({ message: 'ルートを削除しました' });
  } catch (err) {
    res.status(500).json({ error: 'ルートの削除に失敗しました' });
  }
});

router.post('/routes/:id/steps', async (req: Request, res: Response): Promise<void> => {
  const { approver_id, label, action_type } = req.body as {
    approver_id?: string; label?: string; action_type?: string;
  };
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      const orderRes = await client.query(
        `SELECT COALESCE(MAX(step_order), 0) + 1 AS n FROM approval_route_steps WHERE route_id = $1`,
        [req.params.id],
      );
      const order = orderRes.rows[0].n as number;
      await client.query(
        `INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, order, approver_id ?? null, label ?? `ステップ${order}`, action_type ?? 'APPROVE'],
      );
    });
    void invalidateAdminReferenceCache('routes');
    res.status(201).json({ message: 'ステップを追加しました' });
  } catch (err) {
    console.error('[admin] step add failed:', err);
    res.status(500).json({ error: 'ステップの追加に失敗しました' });
  }
});

router.delete('/route-steps/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await query(`DELETE FROM approval_route_steps WHERE id = $1`, [req.params.id]);
    void invalidateAdminReferenceCache('routes');
    res.json({ message: 'ステップを削除しました' });
  } catch (err) {
    res.status(500).json({ error: 'ステップの削除に失敗しました' });
  }
});

// ─── Applications ─────────────────────────────────────────────────────────────

// GET /admin/applications — paginated, server-side filters
// ?search=&dept=&status=&limit=30&offset=0
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

// GET /admin/applications/:id — full admin-only view of one application
//
// Returns everything admin needs to diagnose/audit an application:
//   - application meta + form data (RINGI + SETTLEMENT)
//   - applicant + department + template
//   - all approval steps (including CANCELLED + SKIPPED, which the regular
//     /applications/:id endpoint hides from end users)
//   - settlement row + transfer details
//   - uploaded files
//   - audit log entries for this application (chronological)
//   - internal flags: version, route_id, raw timestamps
router.get('/applications/:id', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  try {
    const [appRes, stepsRes, filesRes, auditRes, settleRes] = await Promise.all([
      // Core app + joined refs
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

      // ALL steps (incl CANCELLED/SKIPPED) for full audit view
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

      // Uploaded files
      query(
        `SELECT id, field_name, original_name, file_size, mime_type, drive_url, created_at,
                uploader_id, stored_path
         FROM uploaded_files
         WHERE application_id = $1
         ORDER BY created_at ASC`,
        [id],
      ),

      // Audit log (limit to recent 100 for this app).
      // Filter by entity_type too — cleaner index use + safer if other
      // entities ever share UUIDs (cross-table joins via audit).
      query(
        `SELECT id, action, entity_type, entity_id, metadata, created_at
         FROM audit_logs
         WHERE entity_type = 'application' AND entity_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [id],
      ),

      // Settlement row if present
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

const ARCHIVABLE_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

router.post('/applications/:id/archive', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const reasonRaw = (req.body as { reason?: string } | undefined)?.reason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : null;

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const appRes = await client.query(
        `SELECT id, status, archived_at
         FROM applications
         WHERE id = $1
         FOR UPDATE`,
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
      `SELECT id, application_number, archived_at
       FROM applications
       WHERE id = $1`,
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
        `SELECT id, application_number, archived_at
         FROM applications
         WHERE id = $1
         FOR UPDATE`,
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
