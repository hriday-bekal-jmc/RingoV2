import { Router } from 'express';
import argon2 from 'argon2';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /admin/users
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.full_name, u.email, u.role, u.is_active,
             d.name AS department_name, d.id AS department_id
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.role, u.full_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] users list failed:', err);
    res.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' });
  }
});

// POST /admin/users — create new user
router.post('/users', async (req, res) => {
  const { full_name, email, password, role, department_id } = req.body;
  if (!full_name || !email) return res.status(400).json({ error: '氏名とメールは必須です' });
  try {
    const password_hash = password ? await argon2.hash(password) : null;
    const r = await query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, full_name, email, role, is_active`,
      [full_name, email.toLowerCase().trim(), password_hash, role || 'EMPLOYEE', department_id || null],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'このメールアドレスは既に使用されています' });
    console.error('[admin] user create failed:', err);
    res.status(500).json({ error: 'ユーザーの作成に失敗しました' });
  }
});

// PATCH /admin/users/:id — update any profile field
router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, email, password, role, department_id, is_active } = req.body;
  try {
    const fields = [];
    const values = [];
    let idx = 1;
    if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); values.push(full_name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email.toLowerCase().trim()); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (department_id !== undefined) { fields.push(`department_id = $${idx++}`); values.push(department_id || null); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
    if (password) {
      const hash = await argon2.hash(password);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(id);
    const r = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, full_name, email, role, is_active`,
      values,
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'このメールアドレスは既に使用されています' });
    console.error('[admin] user update failed:', err);
    res.status(500).json({ error: 'ユーザーの更新に失敗しました' });
  }
});

// DELETE /admin/users/:id — soft delete (is_active=false) to preserve audit trail
// Hard delete only if user has no applications (pass ?hard=true)
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  const hard = req.query.hard === 'true';
  try {
    if (id === req.user?.id) {
      return res.status(400).json({ error: '自分自身を削除することはできません' });
    }
    if (hard) {
      // Check for linked applications first
      const appCheck = await query(`SELECT COUNT(*) AS n FROM applications WHERE applicant_id = $1`, [id]);
      if (Number(appCheck.rows[0].n) > 0) {
        return res.status(409).json({
          error: `このユーザーには ${appCheck.rows[0].n} 件の申請が紐付いています。先に申請を削除してください。`,
        });
      }
      await query(`DELETE FROM users WHERE id = $1`, [id]);
      return res.json({ message: 'ユーザーを完全削除しました', deleted: true });
    }
    // Soft delete
    const r = await query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, full_name`,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `${r.rows[0].full_name} を無効化しました`, soft: true });
  } catch (err) {
    console.error('[admin] user delete failed:', err);
    res.status(500).json({ error: 'ユーザーの削除に失敗しました' });
  }
});

// ─── DEPARTMENTS ───────────────────────────────────────────────────────────────

// GET /admin/departments
router.get('/departments', async (req, res) => {
  try {
    const result = await query(`SELECT id, name, code FROM departments ORDER BY name`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '部署一覧の取得に失敗しました' });
  }
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /admin/routes — all routes with steps and approver names
router.get('/routes', async (req, res) => {
  try {
    const routes = await query(`
      SELECT
        r.id, r.name, r.stage, r.is_active, r.is_default,
        t.title_ja AS template_name, t.code AS template_code,
        d.name AS department_name
      FROM approval_routes r
      JOIN form_templates t ON r.template_id = t.id
      JOIN departments d ON r.department_id = d.id
      ORDER BY t.title_ja, d.name, r.stage
    `);

    const steps = await query(`
      SELECT
        s.id, s.route_id, s.step_order, s.label, s.action_type,
        u.full_name AS approver_name, u.role AS approver_role, u.id AS approver_id
      FROM approval_route_steps s
      LEFT JOIN users u ON s.approver_id = u.id
      ORDER BY s.route_id, s.step_order
    `);

    const stepsByRoute = steps.rows.reduce((acc, s) => {
      if (!acc[s.route_id]) acc[s.route_id] = [];
      acc[s.route_id].push(s);
      return acc;
    }, {});

    res.json(routes.rows.map((r) => ({ ...r, steps: stepsByRoute[r.id] || [] })));
  } catch (err) {
    console.error('[admin] routes list failed:', err);
    res.status(500).json({ error: 'ルート一覧の取得に失敗しました' });
  }
});

// POST /admin/routes — create a new route
router.post('/routes', async (req, res) => {
  const { template_id, department_id, name, stage, is_default } = req.body;
  try {
    const r = await query(
      `INSERT INTO approval_routes (template_id, department_id, name, stage, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, stage`,
      [template_id, department_id, name, stage || 'RINGI', is_default ?? true],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[admin] route create failed:', err);
    res.status(500).json({ error: 'ルートの作成に失敗しました' });
  }
});

// DELETE /admin/routes/:id
router.delete('/routes/:id', async (req, res) => {
  try {
    await query(`DELETE FROM approval_routes WHERE id = $1`, [req.params.id]);
    res.json({ message: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: 'ルートの削除に失敗しました' });
  }
});

// POST /admin/routes/:id/steps — add a step to a route
router.post('/routes/:id/steps', async (req, res) => {
  const { approver_id, label, action_type } = req.body;
  try {
    const maxRes = await query(
      `SELECT COALESCE(MAX(step_order), 0) AS max_order FROM approval_route_steps WHERE route_id = $1`,
      [req.params.id],
    );
    const nextOrder = Number(maxRes.rows[0].max_order) + 1;
    const r = await query(
      `INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, step_order, label, action_type`,
      [req.params.id, nextOrder, approver_id, label || `ステップ${nextOrder}`, action_type || 'APPROVE'],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[admin] step add failed:', err);
    res.status(500).json({ error: 'ステップの追加に失敗しました' });
  }
});

// DELETE /admin/route-steps/:id — remove a step, reorder remaining
router.delete('/route-steps/:id', async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const s = await client.query(
        `DELETE FROM approval_route_steps WHERE id = $1 RETURNING route_id, step_order`,
        [req.params.id],
      );
      if (s.rows.length === 0) throw Object.assign(new Error('Step not found'), { status: 404 });
      const { route_id, step_order } = s.rows[0];
      await client.query(
        `UPDATE approval_route_steps SET step_order = step_order - 1
         WHERE route_id = $1 AND step_order > $2`,
        [route_id, step_order],
      );
    });
    res.json({ message: 'deleted' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'ステップの削除に失敗しました' });
  }
});

// ─── APPLICATIONS ────────────────────────────────────────────────────────────

// GET /admin/applications — all applications (admin view)
router.get('/applications', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.id, a.application_number, a.status, a.form_data,
        a.created_at, a.submitted_at, a.completed_at,
        t.title_ja AS template_name, t.code AS template_code,
        u.full_name AS applicant_name, u.email AS applicant_email,
        d.name AS department_name
      FROM applications a
      JOIN form_templates t ON a.template_id = t.id
      LEFT JOIN users u ON a.applicant_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY a.created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] applications list failed:', err);
    res.status(500).json({ error: '申請一覧の取得に失敗しました' });
  }
});

// DELETE /admin/applications/:id — hard delete (cascades approval_steps, settlements)
router.delete('/applications/:id', async (req, res) => {
  try {
    const r = await query(
      `DELETE FROM applications WHERE id = $1 RETURNING id, application_number, status`,
      [req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    await query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'ADMIN_DELETE_APPLICATION', 'application', $2, $3::jsonb)`,
      [req.user.id, req.params.id, JSON.stringify({ deleted: r.rows[0] })],
    );
    res.json({ message: '申請を削除しました', application: r.rows[0] });
  } catch (err) {
    console.error('[admin] application delete failed:', err);
    res.status(500).json({ error: '申請の削除に失敗しました' });
  }
});

// ─── TEMPLATES (read-only for picker) ────────────────────────────────────────

// GET /admin/templates
router.get('/templates', async (req, res) => {
  try {
    const result = await query(`SELECT id, code, title_ja FROM form_templates WHERE is_active = TRUE ORDER BY title_ja`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

export default router;
