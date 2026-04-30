import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// 新規申請を保存するAPI
router.post('/', async (req, res, next) => {
  try {
    const { template_id, stage, form_data } = req.body;

    // 【テスト用】まだログイン機能（Auth）を繋いでいないため、ダミーの申請者ユーザーを1人取得（いなければ作成）します
    let userRes = await query('SELECT id FROM users LIMIT 1');
    if (userRes.rows.length === 0) {
      userRes = await query(
        `INSERT INTO users (full_name, email, role) VALUES ('テスト 太郎', 'test@example.com', 'EMPLOYEE') RETURNING id`
      );
    }
    const applicant_id = userRes.rows[0].id;

    // applications（稟議データ）テーブルに保存します
    // ※今回はテストとしてステータスを最初から 'PENDING_APPROVAL' (承認待ち) にします
    const insertRes = await query(
      `INSERT INTO applications (applicant_id, template_id, form_data, status)
       VALUES ($1, $2, $3, 'PENDING_APPROVAL')
       RETURNING id, status`,
      [applicant_id, template_id, form_data]
    );

    res.status(201).json({ 
      message: '申請が完了しました！', 
      application: insertRes.rows[0] 
    });

  } catch (err) {
    console.error('保存エラー:', err);
    res.status(500).json({ error: '申請の保存に失敗しました' });
  }
});

export default router;