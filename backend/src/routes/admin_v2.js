import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// GET /applications/route-preview?template_id=X
// Returns all active RINGI routes for (user's dept + template) with approver names.
// Frontend uses this to show the approval chain before submission.
router.get('/route-preview', async (req, res) => {
  const { template_id } = req.query;
  const department_id = req.user.department_id;

  if (!template_id) return res.status(400).json({ error: 'template_id required' });
  if (!department_id) return res.status(422).json({ error: '部署が設定されていません。管理者にお問い合わせください。' });

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
      return res.json({ routes: [], department_has_route: false });
    }

    const steps = await query(
      `SELECT s.route_id, s.step_order, s.label, s.action_type,
              u.full_name AS approver_name, u.role AS approver_role
       FROM approval_route_steps s
       LEFT JOIN users u ON s.approver_id = u.id
       WHERE s.route_id = ANY($1::uuid[])
       ORDER BY s.route_id, s.step_order`,
      [routes.rows.map((r) => r.id)],
    );

    const stepsByRoute = steps.rows.reduce((acc, s) => {
      if (!acc[s.route_id]) acc[s.route_id] = [];
      acc[s.route_id].push(s);
      return acc;
    }, {});

    const result = routes.rows.map((r) => ({
      ...r,
      steps: stepsByRoute[r.id] || [],
    }));

    res.json({ routes: result, department_has_route: true });
  } catch (err) {
    console.error('[applications] route-preview failed:', err);
    res.status(500).json({ error: 'ルートの取得に失敗しました' });
  }
});

// POST /applications — submit new ringi
router.post('/', async (req, res) => {
  const { template_id, stage, form_data, route_id: chosen_route_id } = req.body;

  try {
    const result = await withTransaction(async (client) => {
      const applicant_id = req.user.id;
      const department_id = req.user.department_id;
      if (!department_id) {
        const err = new Error('あなたの部署が設定されていません。管理者にお問い合わせください。');
        err.status = 422;
        throw err;
      }

      // Use explicitly chosen route if provided, otherwise pick the default
      let route_id = chosen_route_id || null;
      if (!route_id) {
        const routeRes = await client.query(
          `SELECT r.id FROM approval_routes r
           WHERE r.template_id = $1
             AND r.department_id = $2
             AND r.stage = 'RINGI'
             AND r.is_active = TRUE
             AND r.is_default = TRUE
           LIMIT 1`,
          [template_id, department_id],
        );
        if (routeRes.rows.length === 0) {
          const err = new Error('この部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。');
          err.status = 422;
          throw err;
        }
        route_id = routeRes.rows[0].id;
      } else {
        // Verify the chosen route belongs to user's dept + template
        const verify = await client.query(
          `SELECT id FROM approval_routes WHERE id = $1 AND template_id = $2 AND department_id = $3 AND is_active = TRUE`,
          [route_id, template_id, department_id],
        );
        if (verify.rows.length === 0) {
          const err = new Error('選択したルートはこの部署・テンプレートに対して無効です。');
          err.status = 422;
          throw err;
        }
      }

      // Load ordered route steps
      const stepsRes = await client.query(
        `SELECT id, step_order, approver_id, label, action_type
         FROM approval_route_steps
         WHERE route_id = $1
         ORDER BY step_order ASC`,
        [route_id],
      );
      if (stepsRes.rows.length === 0) {
        const err = new Error('Approval route has no steps — check admin config');
        err.status = 422;
        throw err;
      }

      // Insert application
      const appRes = await client.query(
        `INSERT INTO applications (applicant_id, template_id, route_id, form_data, status, submitted_at)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING_APPROVAL', CURRENT_TIMESTAMP)
         RETURNING id, status`,
        [applicant_id, template_id, route_id, JSON.stringify(form_data)],
      );
      const app = appRes.rows[0];

      // Create approval_step rows — first step PENDING, rest WAITING
      for (let i = 0; i < stepsRes.rows.length; i++) {
        const s = stepsRes.rows[i];
        await client.query(
          `INSERT INTO approval_steps
             (application_id, step_order, stage, approver_id, label, action_type, status)
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
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[applications] submit failed:', err);
    res.status(500).json({ error: '申請の保存に失敗しました' });
  }
});

// GET /applications — applicant's own list
router.get('/', async (req, res) => {
  try {
    const applicant_id = req.user.id;

    const result = await query(
      `SELECT
         a.id,
         a.application_number,
         a.status,
         a.form_data,
         a.created_at,
         a.submitted_at,
         t.title_ja AS template_name
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       WHERE a.applicant_id = $1
       ORDER BY a.created_at DESC`,
      [applicant_id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[applications] list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

// GET /applications/:id — full detail + approval timeline
router.get('/:id', async (req, res) => {
  try {
    const appRes = await query(
      `SELECT
         a.id, a.application_number, a.status, a.form_data, a.version,
         a.created_at, a.submitted_at, a.completed_at,
         t.title_ja AS template_name,
         u.full_name AS applicant_name
       FROM applications a
       JOIN form_templates t ON a.template_id = t.id
       LEFT JOIN users u ON a.applicant_id = u.id
       WHERE a.id = $1`,
      [req.params.id],
    );
    if (appRes.rows.length === 0) return res.status(404).json({ error: 'Application not found' });

    const stepsRes = await query(
      `SELECT
         s.step_order, s.stage, s.status, s.label, s.action_type,
         s.comment, s.acted_at,
         u.full_name AS approver_name
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

export default router;
