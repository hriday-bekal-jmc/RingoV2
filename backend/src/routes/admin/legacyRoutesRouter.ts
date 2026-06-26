import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../../config/db';
import { getJsonCache, setJsonCache } from '../../services/cache';
import { validateBody } from '../../middlewares/validate';
import {
  ADMIN_REF_CACHE_TTL_SEC,
  adminRefCacheKey,
  invalidateAdminReferenceCache,
} from '../../services/adminReferenceCache';
import { invalidateRoutePreviews } from '../applicationRoutes';
import {
  createRouteSchema, type CreateRouteBody,
  addRouteStepSchema, type AddRouteStepBody,
} from '../../schemas/adminSchemas';
import type pg from 'pg';

const router = Router();

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
             u.avatar_url AS approver_avatar
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

router.post('/routes', validateBody(createRouteSchema), async (req: Request, res: Response): Promise<void> => {
  const { template_id, department_id, name, stage } = req.body as CreateRouteBody;
  try {
    await query(
      `INSERT INTO approval_routes (template_id, department_id, name, stage, is_active)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [template_id, department_id, name, stage ?? 'RINGI'],
    );
    void invalidateAdminReferenceCache('routes');
    void invalidateRoutePreviews(template_id);
    res.status(201).json({ message: 'ルートを作成しました' });
  } catch (err) {
    console.error('[admin] route create failed:', err);
    res.status(500).json({ error: 'ルートの作成に失敗しました' });
  }
});

router.delete('/routes/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(`SELECT template_id FROM approval_routes WHERE id = $1`, [req.params.id]);
    await query(`DELETE FROM approval_routes WHERE id = $1`, [req.params.id]);
    void invalidateAdminReferenceCache('routes');
    if (r.rows[0]?.template_id) void invalidateRoutePreviews(r.rows[0].template_id as string);
    res.json({ message: 'ルートを削除しました' });
  } catch (err) {
    res.status(500).json({ error: 'ルートの削除に失敗しました' });
  }
});

router.post('/routes/:id/steps', validateBody(addRouteStepSchema), async (req: Request, res: Response): Promise<void> => {
  const { approver_id, label, action_type, insert_after } = req.body as AddRouteStepBody;
  try {
    const r = await query(`SELECT template_id FROM approval_routes WHERE id = $1`, [req.params.id]);
    await withTransaction(async (client: pg.PoolClient) => {
      let order: number;
      if (insert_after !== undefined) {
        await client.query(
          `UPDATE approval_route_steps SET step_order = step_order + 1
           WHERE route_id = $1 AND step_order > $2`,
          [req.params.id, insert_after],
        );
        order = insert_after + 1;
      } else {
        const orderRes = await client.query(
          `SELECT COALESCE(MAX(step_order), 0) + 1 AS n FROM approval_route_steps WHERE route_id = $1`,
          [req.params.id],
        );
        order = orderRes.rows[0].n as number;
      }
      await client.query(
        `INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, order, approver_id ?? null, label ?? `ステップ${order}`, action_type ?? 'APPROVE'],
      );
    });
    void invalidateAdminReferenceCache('routes');
    if (r.rows[0]?.template_id) void invalidateRoutePreviews(r.rows[0].template_id as string);
    res.status(201).json({ message: 'ステップを追加しました' });
  } catch (err) {
    console.error('[admin] step add failed:', err);
    res.status(500).json({ error: 'ステップの追加に失敗しました' });
  }
});

router.delete('/route-steps/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT ar.template_id FROM approval_route_steps ars
       JOIN approval_routes ar ON ar.id = ars.route_id
       WHERE ars.id = $1`,
      [req.params.id],
    );
    await query(`DELETE FROM approval_route_steps WHERE id = $1`, [req.params.id]);
    void invalidateAdminReferenceCache('routes');
    if (r.rows[0]?.template_id) void invalidateRoutePreviews(r.rows[0].template_id as string);
    res.json({ message: 'ステップを削除しました' });
  } catch (err) {
    res.status(500).json({ error: 'ステップの削除に失敗しました' });
  }
});

export default router;
