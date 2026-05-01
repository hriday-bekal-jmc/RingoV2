import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);

// GET /applications/route-preview?template_id=X
router.get('/route-preview', async (req: Request, res: Response): Promise<void> => {
  const { template_id } = req.query as { template_id?: string };
  const department_id = req.user!.department_id;

  if (!template_id) { res.status(400).json({ error: 'template_id required' }); return; }
  if (!department_id) { res.status(422).json({ error: '部署が設定されていません。管理者にお問い合わせください。' }); return; }

  try {
    const routes = await query(
      `SELECT r.id, r.name, r.is_default
       FROM approval_routes r
       WHERE r.template_id = $1
         AND r.department_id = $2
         AND r.stage = 'RINGI'
         AND r.is_active = TRUE
       ORDER BY r.is_default DESC, r.name ASC`,
      [template_id, department_id],
    );

    if (routes.rows.length === 0) {
      res.json({ routes: [], department_has_route: false }); return;
    }

    const steps = await query(
      `SELECT s.route_id, s.step_order, s.label, s.action_type,
              u.full_name AS approver_name, u.role AS approver_role
       FROM approval_route_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.route_id = ANY($1::uuid[])
       ORDER BY s.route_id, s.step_order`,
      [routes.rows.map((r: { id: string }) => r.id)],
    );

    const stepsByRoute = steps.rows.reduce<Record<string, unknown[]>>((acc, s) => {
      const key = (s as { route_id: string }).route_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    }, {});

    const result = routes.rows.map((r: { id: string }) => ({
      ...r,
      steps: stepsByRoute[r.id] || [],
    }));

    res.json({ routes: result, department_has_route: true });
  } catch (err) {
    console.error('[applications] route-preview failed:', err);
    res.status(500).json({ error: 'ルートの取得に失敗しました' });
  }
});

// POST /applications/draft — save a draft (no approval steps, no route required)
router.post('/draft', async (req: Request, res: Response): Promise<void> => {
  const { template_id, form_data } = req.body as {
    template_id: string;
    form_data: Record<string, unknown>;
  };
  try {
    const applicant_id = req.user!.id;
    const result = await query(
      `INSERT INTO applications (applicant_id, template_id, form_data, status)
       VALUES ($1, $2, $3::jsonb, 'DRAFT')
       RETURNING id, status`,
      [applicant_id, template_id, JSON.stringify(form_data)],
    );
    res.status(201).json({ message: '下書きを保存しました', application: result.rows[0], draft: true });
  } catch (err) {
    console.error('[applications] draft save failed:', err);
    res.status(500).json({ error: '下書きの保存に失敗しました' });
  }
});

// PATCH /applications/:id — update draft form_data (DRAFT status only)
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { form_data } = req.body as { form_data: Record<string, unknown> };
  const applicant_id = req.user!.id;
  try {
    const result = await query(
      `UPDATE applications
       SET form_data = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND applicant_id = $3 AND status = 'DRAFT'
       RETURNING id, status`,
      [JSON.stringify(form_data), req.params.id, applicant_id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: '下書きが見つかりません（または編集権限がありません）' }); return;
    }
    res.json({ message: '下書きを更新しました', application: result.rows[0] });
  } catch (err) {
    console.error('[applications] draft update failed:', err);
    res.status(500).json({ error: '下書きの更新に失敗しました' });
  }
});

// POST /applications/:id/submit — convert DRAFT → PENDING_APPROVAL with approval steps
router.post('/:id/submit', async (req: Request, res: Response): Promise<void> => {
  const { route_id: chosen_route_id } = req.body as { route_id?: string };
  const applicant_id = req.user!.id;
  const department_id = req.user!.department_id;

  if (!department_id) { res.status(422).json({ error: '部署が設定されていません。管理者にお問い合わせください。' }); return; }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Load and lock the draft
      const draftRes = await client.query(
        `SELECT id, status, template_id FROM applications
         WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT' FOR UPDATE`,
        [req.params.id, applicant_id],
      );
      if (draftRes.rows.length === 0) {
        throw Object.assign(new Error('下書きが見つかりません'), { status: 404 });
      }
      const { template_id } = draftRes.rows[0] as { template_id: string; id: string; status: string };

      // Resolve route
      let route_id: string = chosen_route_id || '';
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT id FROM approval_routes
           WHERE template_id = $1 AND department_id = $2 AND stage = 'RINGI' AND is_active = TRUE AND is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) throw Object.assign(new Error('承認ルートが設定されていません'), { status: 422 });
        route_id = routeRes.rows[0].id as string;
      }

      // Load steps
      const stepsRes = await client.query(
        `SELECT id, step_order, approver_id, label, action_type
         FROM approval_route_steps WHERE route_id = $1 ORDER BY step_order ASC`,
        [route_id],
      );
      if (stepsRes.rows.length === 0) throw Object.assign(new Error('ルートにステップがありません'), { status: 422 });

      // Update application to PENDING_APPROVAL
      await client.query(
        `UPDATE applications SET status = 'PENDING_APPROVAL', route_id = $2, submitted_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, route_id],
      );

      // Create approval steps
      for (let i = 0; i < stepsRes.rows.length; i++) {
        const s = stepsRes.rows[i] as { step_order: number; approver_id: string; label: string; action_type: string };
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'RINGI', $3, $4, $5, $6)`,
          [req.params.id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('DRAFT_SUBMIT', 'application', $1)`,
        [req.params.id],
      );
      return { id: req.params.id, status: 'PENDING_APPROVAL', total_steps: stepsRes.rows.length };
    });
    res.json({ message: '申請を提出しました', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] draft submit failed:', err);
    res.status(500).json({ error: '申請の提出に失敗しました' });
  }
});

// POST /applications — submit new ringi
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { template_id, stage, form_data, route_id: chosen_route_id } = req.body as {
    template_id: string;
    stage?: string;
    form_data: Record<string, unknown>;
    route_id?: string;
  };

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      const applicant_id  = req.user!.id;
      const department_id = req.user!.department_id;

      if (!department_id) {
        const err = Object.assign(new Error('あなたの部署が設定されていません。管理者にお問い合わせください。'), { status: 422 });
        throw err;
      }

      let route_id: string = chosen_route_id || '';

      if (!route_id) {
        const routeRes = await client.query(
          `SELECT r.id FROM approval_routes r
           WHERE r.template_id = $1 AND r.department_id = $2
             AND r.stage = 'RINGI' AND r.is_active = TRUE AND r.is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          throw Object.assign(
            new Error('この部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。'),
            { status: 422 },
          );
        }
        route_id = routeRes.rows[0].id as string;
      } else {
        const verify = await client.query(
          `SELECT id FROM approval_routes
           WHERE id = $1 AND template_id = $2 AND department_id = $3 AND is_active = TRUE`,
          [route_id, template_id, department_id],
        );
        if (verify.rows.length === 0) {
          throw Object.assign(
            new Error('選択したルートはこの部署・テンプレートに対して無効です。'),
            { status: 422 },
          );
        }
      }

      const stepsRes = await client.query(
        `SELECT id, step_order, approver_id, label, action_type
         FROM approval_route_steps WHERE route_id = $1 ORDER BY step_order ASC`,
        [route_id],
      );
      if (stepsRes.rows.length === 0) {
        throw Object.assign(new Error('Approval route has no steps — check admin config'), { status: 422 });
      }

      const appRes = await client.query(
        `INSERT INTO applications (applicant_id, template_id, route_id, form_data, status, submitted_at)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING_APPROVAL', CURRENT_TIMESTAMP)
         RETURNING id, status`,
        [applicant_id, template_id, route_id, JSON.stringify(form_data)],
      );
      const app = appRes.rows[0] as { id: string; status: string };

      for (let i = 0; i < stepsRes.rows.length; i++) {
        const s = stepsRes.rows[i] as { id: string; step_order: number; approver_id: string; label: string; action_type: string };
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'RINGI', $3, $4, $5, $6)`,
          [app.id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING'],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
         VALUES ('APPLICATION_SUBMIT', 'application', $1, $2::jsonb)`,
        [app.id, JSON.stringify({ template_id, stage, steps: stepsRes.rows.length })],
      );

      return { ...app, total_steps: stepsRes.rows.length };
    });

    res.status(201).json({ message: '申請が完了しました！', application: result });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[applications] submit failed:', err);
    res.status(500).json({ error: '申請の保存に失敗しました' });
  }
});

// GET /applications — applicant's own list
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT
         a.id, a.application_number, a.status, a.created_at, a.submitted_at,
         t.title_ja AS template_name, t.code AS template_code,
         -- step progress for PENDING_APPROVAL
         (SELECT s.step_order FROM approval_steps s
          WHERE s.application_id = a.id AND s.stage = 'RINGI' AND s.status = 'PENDING'
          LIMIT 1) AS current_step,
         (SELECT COUNT(*) FROM approval_steps s
          WHERE s.application_id = a.id AND s.stage = 'RINGI') AS total_steps
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       WHERE a.applicant_id = $1
       ORDER BY a.created_at DESC`,
      [req.user!.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[applications] list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

// GET /applications/:id — full detail + approval timeline
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const appRes = await query(
      `SELECT a.id, a.application_number, a.status, a.form_data, a.version,
              a.template_id, a.created_at, a.submitted_at, a.completed_at,
              t.title_ja AS template_name, t.code AS template_code,
              t.schema_definition, t.settlement_schema,
              u.full_name AS applicant_name
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       WHERE a.id = $1`,
      [req.params.id],
    );
    if (appRes.rows.length === 0) { res.status(404).json({ error: 'Application not found' }); return; }

    const stepsRes = await query(
      `SELECT s.step_order, s.stage, s.status, s.label, s.action_type,
              s.comment, s.acted_at, u.full_name AS approver_name
       FROM approval_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.application_id = $1
       ORDER BY s.stage, s.step_order`,
      [req.params.id],
    );

    res.json({ ...appRes.rows[0], steps: stepsRes.rows });
  } catch (err) {
    console.error('[applications] detail failed:', err);
    res.status(500).json({ error: '申請詳細の取得に失敗しました' });
  }
});

// DELETE /applications/:id — delete own DRAFT only
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `DELETE FROM applications
       WHERE id = $1 AND applicant_id = $2 AND status = 'DRAFT'
       RETURNING id`,
      [req.params.id, req.user!.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: '下書きが見つかりません（または削除権限がありません）' }); return;
    }
    res.json({ message: '下書きを削除しました' });
  } catch (err) {
    console.error('[applications] draft delete failed:', err);
    res.status(500).json({ error: '下書きの削除に失敗しました' });
  }
});

export default router;
