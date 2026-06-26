import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { query, withTransaction, pool } from '../../config/db';
import { invalidateUserStateCache } from '../../middlewares/authMiddleware';
import { insertOutboxEvent } from '../../services/eventOutbox';
import { SUPER_ADMIN_EMAILS } from '../../config/env';
import { invalidateAdminReferenceCache } from '../../services/adminReferenceCache';
import { validateBody } from '../../middlewares/validate';
import { isValidGChatWebhook } from '../../services/gchatService';
import { invalidateChainPreviews } from '../applicationRoutes';
import {
  createUserSchema, type CreateUserBody,
  updateUserSchema, type UpdateUserBody,
  upsertUserSlotsSchema, type UpsertUserSlotsBody,
  copyFromUserSchema, type CopyFromUserBody,
} from '../../schemas/adminSchemas';

const router = Router();

const USER_ROLES = new Set([
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT',
]);
// ponytail: kept for future validation use; currently only hasOtherActiveAdmin uses it indirectly
export const isValidBusinessRole = (role: unknown): role is string =>
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

const VALID_CAPABILITIES = new Set(['can_approve', 'can_settle', 'can_admin']);

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`
      SELECT u.id, u.full_name, u.email, u.role,
             (u.is_admin OR lower(u.email) = ANY($1::text[])) AS is_admin,
             u.is_active, u.department_id,
             u.avatar_url,
             u.notify_email, u.notify_gchat, u.gchat_webhook_url,
             d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `, [[...SUPER_ADMIN_EMAILS]]);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] users list failed:', err);
    res.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' });
  }
});

router.post('/users', validateBody(createUserSchema), async (req: Request, res: Response): Promise<void> => {
  const { full_name, email, role, is_admin, department_id, password, is_active } = req.body as CreateUserBody;
  try {
    const hash = password ? await argon2.hash(password) : null;
    const rateRow = await query(
      `SELECT daily_rate_yen FROM allowance_rates WHERE role = $1 LIMIT 1`,
      [role],
    );
    const dailyRate: number | null = rateRow.rows[0]?.daily_rate_yen ?? null;

    await query(
      `INSERT INTO users (full_name, email, role, is_admin, department_id, password_hash, is_active,
                          daily_allowance_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [full_name, email.toLowerCase().trim(), role, is_admin ?? false, department_id ?? null, hash, is_active ?? true, dailyRate],
    );
    void invalidateAdminReferenceCache('routes');
    res.status(201).json({ message: 'ユーザーを作成しました' });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') { res.status(409).json({ error: 'このメールアドレスは既に使用されています' }); return; }
    if (e.code === '23514') { res.status(400).json({ error: `無効なロール: ${role}` }); return; }
    console.error('[admin] user create failed:', err);
    res.status(500).json({ error: 'ユーザーの作成に失敗しました' });
  }
});

router.patch('/users/:id', validateBody(updateUserSchema), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { full_name, email, role, is_admin, department_id, password, is_active } = req.body as UpdateUserBody;

  try {
    // ─── SUPER ADMIN SAFEGUARD ───
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
    const roleChanged       = before && role !== undefined && before.role !== role;
    const adminChanged      = before && is_admin !== undefined && before.is_admin !== is_admin;
    const activationChanged = before && is_active !== undefined && before.is_active !== is_active;
    const passwordChanged   = !!password;
    const bumpTokenVersion  = roleChanged || adminChanged || activationChanged || passwordChanged;
    const demotingAdmin     = before.is_admin && (is_admin === false || is_active === false);

    const passwordHash = password ? await argon2.hash(password) : null;

    const params: unknown[] = [
      full_name ?? before.full_name,
      email?.toLowerCase().trim() ?? before.email,
      role ?? before.role,
      is_admin ?? before.is_admin,
      department_id === undefined ? before.department_id : department_id ?? null,
      is_active ?? before.is_active,
    ];
    let q = `UPDATE users SET full_name=$1, email=$2, role=$3, is_admin=$4, department_id=$5, is_active=$6`;
    if (passwordHash) {
      params.push(passwordHash);
      q += `, password_hash=$${params.length}`;
    }
    if (bumpTokenVersion) {
      q += `, token_version = token_version + 1`;
    }
    q += ` WHERE id=$${params.length + 1}`;
    params.push(id);

    try {
      await withTransaction(async (client) => {
        if (demotingAdmin) {
          await client.query(`SELECT pg_advisory_xact_lock(hashtext('ringo-admin-guard'))`);
          const others = await client.query(
            `SELECT 1 FROM users WHERE is_admin = TRUE AND is_active = TRUE AND id != $1 LIMIT 1`,
            [id],
          );
          if (others.rowCount === 0) {
            throw Object.assign(new Error('At least one active admin is required'), { status: 409 });
          }
        }
        await client.query(q, params);
        if (roleChanged) {
          await client.query(
            `UPDATE users u SET daily_allowance_rate = ar.daily_rate_yen
             FROM allowance_rates ar WHERE ar.role = $1 AND u.id = $2`,
            [role ?? before.role, id],
          );
        }
        if (bumpTokenVersion) {
          await insertOutboxEvent(client, {
            event_type:         'user-state-changed',
            entity_type:        'user',
            entity_id:          String(id),
            recipient_user_ids: [String(id)],
            payload:            { reason: 'profile-updated' },
          });
        }
      });
    } catch (txErr) {
      const te = txErr as { status?: number; message?: string };
      if (te.status === 409) { res.status(409).json({ error: te.message }); return; }
      throw txErr;
    }

    await invalidateUserStateCache(String(id));
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

    const [pendingSteps, slotAssignments] = await Promise.all([
      query(
        `SELECT a.application_number, ast.label, ast.stage
         FROM approval_steps ast
         JOIN applications a ON a.id = ast.application_id
         WHERE ast.approver_id = $1 AND ast.status = 'PENDING'
         ORDER BY a.created_at DESC LIMIT 50`,
        [req.params.id],
      ),
      query(
        `SELECT owner.full_name AS owner_name, s.label_ja AS slot_label
         FROM user_approval_slots uas
         JOIN users owner ON owner.id = uas.user_id AND owner.is_active = TRUE
         JOIN approval_slots s ON s.id = uas.slot_id
         WHERE uas.approver_id = $1`,
        [req.params.id],
      ),
    ]);
    if (pendingSteps.rows.length > 0 || slotAssignments.rows.length > 0) {
      res.status(409).json({
        error:            'slot_and_step_assignments',
        pending_steps:    pendingSteps.rows,
        slot_assignments: slotAssignments.rows,
      });
      return;
    }

    if (req.query.hard === 'true') {
      await query(
        `UPDATE users
         SET deleted_at    = NOW(),
             is_active     = FALSE,
             token_version = token_version + 1,
             email         = 'deleted_' || id::text,
             full_name     = '削除済みユーザー',
             password_hash = NULL,
             avatar_url    = NULL
         WHERE id = $1`,
        [req.params.id],
      );
    } else {
      await query(
        `UPDATE users SET is_active = FALSE, token_version = token_version + 1 WHERE id = $1`,
        [req.params.id],
      );
    }
    await invalidateUserStateCache(String(req.params.id));
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

// ─── User Notification Settings ──────────────────────────────────────────────

router.patch('/users/:id/notifications', async (req: Request, res: Response): Promise<void> => {
  const targetId = String(req.params.id);
  const { notify_email, notify_gchat, gchat_webhook_url } = req.body as {
    notify_email?: boolean;
    notify_gchat?: boolean;
    gchat_webhook_url?: string | null;
  };

  if (gchat_webhook_url !== undefined && gchat_webhook_url !== null && gchat_webhook_url !== '') {
    if (!isValidGChatWebhook(gchat_webhook_url)) {
      res.status(400).json({ error: 'Google Chat Webhook URLが無効です。https://chat.googleapis.com/ で始まる必要があります。' });
      return;
    }
  }

  try {
    const r = await pool.query(
      `UPDATE users
       SET notify_email      = COALESCE($1, notify_email),
           notify_gchat      = COALESCE($2, notify_gchat),
           gchat_webhook_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE gchat_webhook_url END,
           updated_at        = NOW()
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING id, notify_email, notify_gchat, gchat_webhook_url`,
      [
        notify_email ?? null,
        notify_gchat ?? null,
        gchat_webhook_url !== undefined ? (gchat_webhook_url || null) : null,
        targetId,
      ],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'ユーザーが見つかりません' }); return;
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[admin] user notification update failed:', err);
    res.status(500).json({ error: '通知設定の更新に失敗しました' });
  }
});

// ─── User capability overrides ───────────────────────────────────────────────

router.get('/users/:id/capability-overrides', async (req: Request, res: Response): Promise<void> => {
  try {
    const res2 = await query(
      `SELECT capability, created_at FROM user_capability_overrides WHERE user_id = $1`,
      [req.params.id],
    );
    res.json(res2.rows);
  } catch (err) {
    console.error('[admin] get overrides failed:', err);
    res.status(500).json({ error: '権限オーバーライドの取得に失敗しました' });
  }
});

router.put('/users/:id/capability-overrides', async (req: Request, res: Response): Promise<void> => {
  const { capabilities } = req.body as { capabilities?: string[] };
  if (!Array.isArray(capabilities)) {
    res.status(400).json({ error: 'capabilities must be an array' }); return;
  }
  const invalid = capabilities.filter((c) => !VALID_CAPABILITIES.has(c));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Invalid capabilities: ${invalid.join(', ')}` }); return;
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM user_capability_overrides WHERE user_id = $1`,
        [req.params.id],
      );
      if (capabilities.length > 0) {
        const placeholders = capabilities.map((_, i) => `($1, $${i + 2}, $${capabilities.length + 2})`).join(', ');
        await client.query(
          `INSERT INTO user_capability_overrides (user_id, capability, granted_by) VALUES ${placeholders}`,
          [req.params.id, ...capabilities, req.user!.id],
        );
      }
    });
    await invalidateUserStateCache(String(req.params.id));
    res.json({ capabilities });
  } catch (err) {
    console.error('[admin] set overrides failed:', err);
    res.status(500).json({ error: '権限オーバーライドの更新に失敗しました' });
  }
});

// ─── User approval slots ─────────────────────────────────────────────────────

router.get('/users/:id/approval-slots', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT s.id AS slot_id, s.slot_code, s.label_ja, s.slot_type, s.sort_order,
              uas.approver_id,
              u.full_name AS approver_name, u.avatar_url AS approver_avatar
       FROM approval_slots s
       LEFT JOIN user_approval_slots uas ON uas.slot_id = s.id AND uas.user_id = $1
       LEFT JOIN users u ON u.id = uas.approver_id
       ORDER BY s.sort_order ASC`,
      [req.params.id],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] user approval-slots get failed:', err);
    res.status(500).json({ error: 'ユーザーのスロット取得に失敗しました' });
  }
});

router.put('/users/:id/approval-slots', validateBody(upsertUserSlotsSchema), async (req: Request, res: Response): Promise<void> => {
  const { slots } = req.body as UpsertUserSlotsBody;
  try {
    await query(
      `INSERT INTO user_approval_slots (user_id, slot_id, approver_id, updated_by)
       SELECT $1, unnest($2::uuid[]), unnest($3::uuid[]), $4
       ON CONFLICT (user_id, slot_id) DO UPDATE
         SET approver_id = EXCLUDED.approver_id, updated_by = EXCLUDED.updated_by`,
      [req.params.id, slots.map(s => s.slot_id), slots.map(s => s.approver_id), req.user!.id],
    );
    void invalidateChainPreviews(String(req.params.id));
    res.json({ message: 'スロットを更新しました' });
  } catch (err) {
    console.error('[admin] user approval-slots upsert failed:', err);
    res.status(500).json({ error: 'スロットの更新に失敗しました' });
  }
});

router.post('/users/:id/approval-slots/copy-from', validateBody(copyFromUserSchema), async (req: Request, res: Response): Promise<void> => {
  const { source_user_id, force } = req.body as CopyFromUserBody;
  try {
    const r = await query(
      `INSERT INTO user_approval_slots (user_id, slot_id, approver_id, updated_by)
       SELECT $1, slot_id, approver_id, $3
       FROM user_approval_slots
       WHERE user_id = $2 AND approver_id IS NOT NULL
       ON CONFLICT (user_id, slot_id) DO ${force ? 'UPDATE SET approver_id = EXCLUDED.approver_id, updated_by = EXCLUDED.updated_by' : 'NOTHING'}`,
      [req.params.id, source_user_id, req.user!.id],
    );
    void invalidateChainPreviews(String(req.params.id));
    res.json({ copied: r.rowCount ?? 0 });
  } catch (err) {
    console.error('[admin] copy-from-user slots failed:', err);
    res.status(500).json({ error: 'スロットのコピーに失敗しました' });
  }
});

export default router;
