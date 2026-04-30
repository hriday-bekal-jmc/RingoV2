import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// GET /templates — list all active templates
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, code, title_ja FROM form_templates WHERE is_active = TRUE ORDER BY title_ja`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// テンプレートのコード（例: BUSINESS_TRIP）を指定してデータを取得するAPI
router.get('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const result = await query(
      'SELECT id, code, title, title_ja, schema_definition, settlement_schema FROM form_templates WHERE code = $1 AND is_active = true',
      [code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;