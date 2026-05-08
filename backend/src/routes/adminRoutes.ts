import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { query, withTransaction } from '../config/db';
import { requireAuth, requireRole, invalidateUserStateCache } from '../middlewares/authMiddleware';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`
      SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.department_id,
             u.avatar_url, d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] users list failed:', err);
    res.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' });
  }
});

router.post('/users', async (req: Request, res: Response): Promise<void> => {
  const { full_name, email, role, department_id, password, is_active } = req.body as {
    full_name: string; email: string; role: string;
    department_id?: string; password?: string; is_active?: boolean;
  };
  try {
    const hash = password ? await argon2.hash(password) : null;
    await query(
      `INSERT INTO users (full_name, email, role, department_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [full_name, email.toLowerCase().trim(), role, department_id ?? null, hash, is_active ?? true],
    );
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
  const { full_name, email, role, department_id, password, is_active } = req.body as {
    full_name?: string; email?: string; role?: string;
    department_id?: string | null; password?: string; is_active?: boolean;
  };

  try {
    // ─── SUPER ADMIN SAFEGUARD (スーパー管理者の保護) ───
    const targetRes = await query(`SELECT email FROM users WHERE id = $1`, [id]);
    if (targetRes.rows.length > 0) {
      const targetEmail = targetRes.rows[0].email;
      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();

      if (superAdminEmail && targetEmail === superAdminEmail) {
        if (is_active === false) {
          res.status(403).json({ error: 'システム管理者のアカウントは無効化できません。' });
          return;
        }
        if (role && role !== 'ADMIN') {
          res.status(403).json({ error: 'システム管理者の権限（ロール）は変更できません。' });
          return;
        }
      }
    }
    // ────────────────────────────────────────────────

    // Detect privilege-relevant change → bump token_version to revoke old JWTs
    const beforeRes = await query(
      `SELECT role, is_active FROM users WHERE id = $1`,
      [id],
    );
    const before = beforeRes.rows[0] as { role: string; is_active: boolean } | undefined;
    const roleChanged     = before && role !== undefined && before.role !== role;
    const activationChanged = before && is_active !== undefined && before.is_active !== is_active;
    const passwordChanged = !!password;
    const bumpTokenVersion = roleChanged || activationChanged || passwordChanged;

    const params: unknown[] = [full_name, email?.toLowerCase().trim(), role, department_id ?? null, is_active];
    let q = `UPDATE users SET full_name=$1, email=$2, role=$3, department_id=$4, is_active=$5`;

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
    if (bumpTokenVersion) await invalidateUserStateCache(String(id));
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
    const targetRes = await query(`SELECT email FROM users WHERE id = $1`, [req.params.id]);
    if (targetRes.rows.length > 0) {
      const targetEmail = targetRes.rows[0].email;
      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();

      if (superAdminEmail && targetEmail === superAdminEmail) {
        res.status(403).json({ error: 'システム管理者のアカウントは削除できません。' });
        return;
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
    res.json({ message: 'ユーザーを削除/無効化しました' });
  } catch (err) {
    console.error('[admin] user delete failed:', err);
    res.status(500).json({ error: 'ユーザーの削除に失敗しました' });
  }
});

// ─── Departments & Templates ──────────────────────────────────────────────────

router.get('/departments', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`SELECT id, name, code FROM departments ORDER BY created_at`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '部署一覧の取得に失敗しました' });
  }
});

router.get('/templates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`SELECT id, code, title_ja FROM form_templates ORDER BY created_at`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// ─── Routes & Steps ──────────────────────────────────────────────────────────

router.get('/routes', async (_req: Request, res: Response): Promise<void> => {
  try {
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
             s.approver_id, u.full_name AS approver_name, u.avatar_url AS approver_avatar
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
    res.json(routes.rows.map((r: { id: string }) => ({ ...r, steps: stepsByRoute[r.id] ?? [] })));
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
    res.status(201).json({ message: 'ルートを作成しました' });
  } catch (err) {
    console.error('[admin] route create failed:', err);
    res.status(500).json({ error: 'ルートの作成に失敗しました' });
  }
});

router.delete('/routes/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await query(`DELETE FROM approval_routes WHERE id = $1`, [req.params.id]);
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
    res.status(201).json({ message: 'ステップを追加しました' });
  } catch (err) {
    console.error('[admin] step add failed:', err);
    res.status(500).json({ error: 'ステップの追加に失敗しました' });
  }
});

router.delete('/route-steps/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await query(`DELETE FROM approval_route_steps WHERE id = $1`, [req.params.id]);
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
  const limit  = Math.min(Number(req.query.limit  ?? 30), 200);
  const offset = Math.max(Number(req.query.offset ?? 0),  0);

  try {
    const result = await query(
      `SELECT a.id, a.application_number, a.status, a.created_at,
              t.title_ja AS template_name,
              u.full_name AS applicant_name,
              u.email AS applicant_email,
              d.name AS department_name
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE ($1 = '' OR (
         u.full_name ILIKE $1 OR
         t.title_ja  ILIKE $1 OR
         a.application_number ILIKE $1
       ))
       AND ($2 = '' OR d.name = $2)
       AND ($3 = '' OR a.status = $3)
       ORDER BY a.created_at DESC
       LIMIT $4 OFFSET $5`,
      [`%${search}%`.replace('%%', '%'), dept, status, limit + 1, offset],
    );
    // Empty search = '' → ILIKE '%' matches everything. But we pass '%search%' so
    // for empty search the condition becomes "'' = '' OR ..." which short-circuits. ✓
    const rows    = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({ items: rows, hasMore, offset });
  } catch (err) {
    console.error('[admin] applications list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

router.delete('/applications/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await query(`DELETE FROM applications WHERE id = $1`, [req.params.id]);
    res.json({ message: '申請データを削除しました' });
  } catch (err) {
    console.error('[admin] application delete failed:', err);
    res.status(500).json({ error: '申請の削除に失敗しました' });
  }
});

export default router;
