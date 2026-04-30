import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// 承認待ちの申請一覧を取得するAPI
router.get('/pending', async (req, res, next) => {
  try {
    // 申請データ(applications)とひな形データ(form_templates)を結合して取得します
    const result = await query(`
      SELECT 
        a.id, 
        a.application_number, 
        a.status, 
        a.form_data, 
        a.created_at,
        t.title_ja AS template_name
      FROM applications a
      JOIN form_templates t ON a.template_id = t.id
      WHERE a.status = 'PENDING_APPROVAL'
      ORDER BY a.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('取得エラー:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

export default router;