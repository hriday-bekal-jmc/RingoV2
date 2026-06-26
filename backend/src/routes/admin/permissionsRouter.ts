import { Router, Request, Response } from 'express';
import { withTransaction, pool } from '../../config/db';
import { insertOutboxEvent } from '../../services/eventOutbox';
import { invalidateRolePermissionsCache } from '../../services/rolePermissionsCache';
import { validateBody } from '../../middlewares/validate';
import { updatePermissionsSchema, type UpdatePermissionsBody } from '../../schemas/adminSchemas';
import type pg from 'pg';

const router = Router();

const KNOWN_ROLES = new Set([
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT', 'ADMIN',
]);

interface RolePermRowAdmin {
  role: string;
  can_submit: boolean;
  can_approve: boolean;
  can_settle: boolean;
  can_admin: boolean;
  nav_pages: string[];
  updated_at: Date;
}

// ─── Role Permissions ─────────────────────────────────────────────────────────

router.get('/role-permissions', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<RolePermRowAdmin>('SELECT * FROM role_permissions ORDER BY role');
    const data: Record<string, {
      canSubmit: boolean;
      canApprove: boolean;
      canSettle: boolean;
      canAdmin: boolean;
      navPages: string[];
    }> = {};

    for (const row of result.rows) {
      data[row.role] = {
        canSubmit:  row.can_submit,
        canApprove: row.can_approve,
        canSettle:  row.can_settle,
        canAdmin:   row.can_admin,
        navPages:   row.nav_pages,
      };
    }

    res.json(data);
  } catch (err) {
    console.error('[admin] role-permissions fetch failed:', err);
    res.status(500).json({ error: '権限情報の取得に失敗しました' });
  }
});

router.patch('/role-permissions/:role', validateBody(updatePermissionsSchema), async (req: Request, res: Response): Promise<void> => {
  const role = String(req.params.role);

  if (!KNOWN_ROLES.has(role)) {
    res.status(400).json({ error: '無効なロールです' });
    return;
  }
  if (role === 'ADMIN') {
    res.status(403).json({ error: 'システム管理者の権限は変更できません' });
    return;
  }

  const { canSubmit, canApprove, canSettle, canAdmin, navPages } = req.body as UpdatePermissionsBody;

  try {
    const { rows: allUsers } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE is_active = TRUE',
    );
    const recipientIds = allUsers.map((u) => u.id);

    const updated = await withTransaction(async (client: pg.PoolClient) => {
      const updateRes = await client.query<RolePermRowAdmin>(
        `INSERT INTO role_permissions (role, can_submit, can_approve, can_settle, can_admin, nav_pages, updated_at)
         VALUES ($6, $1, $2, $3, $4, $5, NOW())
         ON CONFLICT (role) DO UPDATE
           SET can_submit  = EXCLUDED.can_submit,
               can_approve = EXCLUDED.can_approve,
               can_settle  = EXCLUDED.can_settle,
               can_admin   = EXCLUDED.can_admin,
               nav_pages   = EXCLUDED.nav_pages,
               updated_at  = NOW()
         RETURNING *`,
        [canSubmit, canApprove, canSettle, canAdmin, navPages, role],
      );

      await insertOutboxEvent(client, {
        event_type:         'PERMISSIONS_UPDATED',
        entity_type:        'role_permission',
        entity_id:          null,
        recipient_user_ids: recipientIds,
        payload:            { role },
      });

      return updateRes.rows[0];
    });

    invalidateRolePermissionsCache();

    res.json({
      role:       updated.role,
      canSubmit:  updated.can_submit,
      canApprove: updated.can_approve,
      canSettle:  updated.can_settle,
      canAdmin:   updated.can_admin,
      navPages:   updated.nav_pages,
    });
  } catch (err) {
    console.error('[admin] role-permissions update failed:', err);
    res.status(500).json({ error: '権限の更新に失敗しました' });
  }
});

export default router;
