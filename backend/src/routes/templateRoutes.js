import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

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