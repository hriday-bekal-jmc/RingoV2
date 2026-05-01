import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
router.use(requireAuth);

// GET /templates — list all active templates
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, code, title_ja FROM form_templates WHERE is_active = TRUE ORDER BY title_ja`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// GET /templates/:code — get full template schema by code
router.get('/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.params['code'] as string;
    const result = await query(
      `SELECT id, code, title, title_ja, schema_definition, settlement_schema
       FROM form_templates WHERE code = $1 AND is_active = TRUE`,
      [code.toUpperCase()],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' }); return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[templates] fetch failed:', err);
    res.status(500).json({ error: 'テンプレートの取得に失敗しました' });
  }
});

export default router;
