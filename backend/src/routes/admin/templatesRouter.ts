import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../../config/db';
import { getJsonCache, setJsonCache } from '../../services/cache';
import { validateBody } from '../../middlewares/validate';
import {
  ADMIN_REF_CACHE_TTL_SEC,
  adminRefCacheKey,
} from '../../services/adminReferenceCache';
import { invalidateRoutePreviews } from '../applicationRoutes';
import {
  upsertTemplatePatternsSchema, type UpsertTemplatePatternsBody,
  upsertConditionsSchema, type UpsertConditionsBody,
} from '../../schemas/adminSchemas';

const router = Router();

// ─── Templates ────────────────────────────────────────────────────────────────

router.get('/templates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = adminRefCacheKey('templates');
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    const result = await query(`SELECT id, code, title_ja FROM form_templates ORDER BY created_at`);
    void setJsonCache(cacheKey, result.rows, ADMIN_REF_CACHE_TTL_SEC);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// ─── Template patterns ────────────────────────────────────────────────────────

router.get('/templates/:id/patterns', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT ftp.id, ftp.pattern_id, ap.name AS pattern_name, ftp.is_default, ftp.priority
       FROM form_template_patterns ftp
       JOIN approval_patterns ap ON ap.id = ftp.pattern_id
       WHERE ftp.template_id = $1
       ORDER BY ftp.is_default DESC, ftp.priority DESC`,
      [req.params.id],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] template patterns get failed:', err);
    res.status(500).json({ error: 'テンプレートのパターン取得に失敗しました' });
  }
});

router.put('/templates/:id/patterns', validateBody(upsertTemplatePatternsSchema), async (req: Request, res: Response): Promise<void> => {
  const { patterns } = req.body as UpsertTemplatePatternsBody;
  try {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM form_template_patterns WHERE template_id = $1`, [req.params.id]);
      for (const { pattern_id, is_default, priority } of patterns) {
        await client.query(
          `INSERT INTO form_template_patterns (template_id, pattern_id, is_default, priority)
           VALUES ($1, $2, $3, $4)`,
          [req.params.id, pattern_id, is_default, priority],
        );
      }
    });
    void invalidateRoutePreviews(String(req.params.id));
    res.json({ message: 'パターンを更新しました' });
  } catch (err) {
    console.error('[admin] template patterns upsert failed:', err);
    res.status(500).json({ error: 'パターンの更新に失敗しました' });
  }
});

// ─── Template conditions ──────────────────────────────────────────────────────

router.get('/templates/:id/conditions', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT ac.id, ac.pattern_id, ap.name AS pattern_name,
              ac.user_id, u.full_name AS user_name,
              ac.condition_type, ac.condition_value,
              ac.stop_at_slot_id, s.label_ja AS stop_at_label
       FROM approval_conditions ac
       JOIN approval_patterns ap ON ap.id = ac.pattern_id
       JOIN approval_slots s ON s.id = ac.stop_at_slot_id
       LEFT JOIN users u ON u.id = ac.user_id
       WHERE ac.template_id = $1
       ORDER BY ap.name, ac.user_id NULLS LAST`,
      [req.params.id],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] template conditions get failed:', err);
    res.status(500).json({ error: '条件の取得に失敗しました' });
  }
});

router.put('/templates/:id/conditions', validateBody(upsertConditionsSchema), async (req: Request, res: Response): Promise<void> => {
  const { conditions } = req.body as UpsertConditionsBody;
  try {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM approval_conditions WHERE template_id = $1`, [req.params.id]);
      for (const { pattern_id, user_id, condition_type, condition_value, stop_at_slot_id } of conditions) {
        await client.query(
          `INSERT INTO approval_conditions
             (template_id, pattern_id, user_id, condition_type, condition_value, stop_at_slot_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, pattern_id, user_id ?? null, condition_type, condition_value, stop_at_slot_id],
        );
      }
    });
    res.json({ message: '条件を更新しました' });
  } catch (err) {
    console.error('[admin] template conditions upsert failed:', err);
    res.status(500).json({ error: '条件の更新に失敗しました' });
  }
});

export default router;
