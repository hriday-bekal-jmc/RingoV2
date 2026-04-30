import { Router } from 'express';
import argon2 from 'argon2';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

router.get('/users', async (req, res) => {
  const result = await query("SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.department_id, d.name AS department_name FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.created_at DESC");
  res.json(result.rows);
});

router.post('/users', async (req, res) => {
  const { full_name, email, role, department_id, password, is_active } = req.body;
  const hash = password ? await argon2.hash(password) : null;
  await query("INSERT INTO users (full_name, email, role, department_id, password_hash, is_active) VALUES ($1, $2, $3, $4, $5, $6)", [full_name, email, role, department_id || null, hash, is_active ?? true]);
  res.json({ message: 'ユーザーを作成しました' });
});

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role, department_id, password, is_active } = req.body;
  let q = "UPDATE users SET full_name=$1, email=$2, role=$3, department_id=$4, is_active=$5";
  const params = [full_name, email, role, department_id || null, is_active];
  if (password) { params.push(await argon2.hash(password)); q += ", password_hash=$" + params.length; }
  q += " WHERE id=$" + (params.length + 1);
  params.push(id);
  await query(q, params);
  res.json({ message: 'ユーザーを更新しました' });
});

router.delete('/users/:id', async (req, res) => {
  if (req.query.hard === 'true') await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  else await query("UPDATE users SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.json({ message: 'ユーザーを削除/無効化しました' });
});

router.get('/departments', async (req, res) => res.json((await query("SELECT id, name, code FROM departments ORDER BY created_at")).rows));
router.get('/templates', async (req, res) => res.json((await query("SELECT id, code, title_ja FROM form_templates ORDER BY created_at")).rows));

router.get('/routes', async (req, res) => {
  const routes = await query("SELECT r.id, r.name, r.stage, r.is_active, t.title_ja AS template_name, d.name AS department_name FROM approval_routes r JOIN form_templates t ON r.template_id = t.id JOIN departments d ON r.department_id = d.id ORDER BY r.created_at DESC");
  const steps = await query("SELECT s.*, u.full_name AS approver_name FROM approval_route_steps s LEFT JOIN users u ON s.approver_id = u.id ORDER BY s.route_id, s.step_order");
  res.json(routes.rows.map(r => ({ ...r, steps: steps.rows.filter(s => s.route_id === r.id) })));
});

router.post('/routes', async (req, res) => {
  const { template_id, department_id, name, stage } = req.body;
  await query("INSERT INTO approval_routes (template_id, department_id, name, stage) VALUES ($1, $2, $3, $4)", [template_id, department_id, name, stage]);
  res.json({ message: 'ルートを作成しました' });
});

router.delete('/routes/:id', async (req, res) => {
  await query("DELETE FROM approval_routes WHERE id = $1", [req.params.id]);
  res.json({ message: 'ルートを削除しました' });
});

router.post('/routes/:id/steps', async (req, res) => {
  const { approver_id, label, action_type } = req.body;
  await withTransaction(async (c) => {
    const order = (await c.query("SELECT COALESCE(MAX(step_order), 0) + 1 AS n FROM approval_route_steps WHERE route_id = $1", [req.params.id])).rows[0].n;
    await c.query("INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type) VALUES ($1, $2, $3, $4, $5)", [req.params.id, order, approver_id, label, action_type]);
  });
  res.json({ message: 'ステップを追加しました' });
});

router.delete('/route-steps/:id', async (req, res) => {
  await query("DELETE FROM approval_route_steps WHERE id = $1", [req.params.id]);
  res.json({ message: 'ステップを削除しました' });
});

router.get('/applications', async (req, res) => {
  const result = await query("SELECT a.id, a.application_number, a.status, a.created_at, t.title_ja AS template_name, u.full_name AS applicant_name, u.email AS applicant_email, d.name AS department_name FROM applications a JOIN form_templates t ON a.template_id = t.id LEFT JOIN users u ON a.applicant_id = u.id LEFT JOIN departments d ON u.department_id = d.id ORDER BY a.created_at DESC");
  res.json(result.rows);
});

router.delete('/applications/:id', async (req, res) => {
  await query("DELETE FROM applications WHERE id = $1", [req.params.id]);
  res.json({ message: '申請データを削除しました' });
});

export default router;
