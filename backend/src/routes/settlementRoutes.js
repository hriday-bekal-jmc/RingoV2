import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// POST /settlements — 精算（Settlement）データの作成と精算承認ルートの開始
router.post('/', async (req, res) => {
  const { application_id, actual_amount, settlement_data, route_id } = req.body;
  const applicant_id = req.user.id;

  try {
    const result = await withTransaction(async (client) => {
      // 1. 稟議が「APPROVED」になっているか確認
      const appRes = await client.query(
        `SELECT status, template_id FROM applications WHERE id = $1 AND applicant_id = $2 FOR UPDATE`,
        [application_id, applicant_id]
      );
      if (appRes.rows.length === 0 || appRes.rows[0].status !== 'APPROVED') {
        throw { status: 400, message: 'この申請はまだ精算できる状態ではありません。' };
      }

      // 2. 精算データの保存 (settlementsテーブル)
      const settleRes = await client.query(
        `INSERT INTO settlements (application_id, actual_amount, settlement_data, status)
         VALUES ($1, $2, $3::jsonb, 'PENDING_VERIFICATION')
         RETURNING id`,
        [application_id, actual_amount, JSON.stringify(settlement_data)]
      );

      // 3. アプリケーションのステータスを「精算中 (PENDING_SETTLEMENT)」に更新
      await client.query(
        `UPDATE applications SET status = 'PENDING_SETTLEMENT' WHERE id = $1`,
        [application_id]
      );

      // 4. 精算ルート（SETTLEMENT stage）の承認ステップを生成
      const stepsRes = await client.query(
        `SELECT id, step_order, approver_id, label, action_type
         FROM approval_route_steps WHERE route_id = $1 ORDER BY step_order ASC`,
        [route_id]
      );

      for (let i = 0; i < stepsRes.rows.length; i++) {
        const s = stepsRes.rows[i];
        await client.query(
          `INSERT INTO approval_steps (application_id, step_order, stage, approver_id, label, action_type, status)
           VALUES ($1, $2, 'SETTLEMENT', $3, $4, $5, $6)`,
          [application_id, s.step_order, s.approver_id, s.label, s.action_type, i === 0 ? 'PENDING' : 'WAITING']
        );
      }

      // 5. 監査ログ
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('SETTLEMENT_SUBMIT', 'application', $1)`,
        [application_id]
      );

      return settleRes.rows[0];
    });

    res.status(201).json({ message: '精算申請を提出しました', settlement: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[settlements] create failed:', err);
    res.status(500).json({ error: '精算の作成に失敗しました' });
  }
});

export default router;