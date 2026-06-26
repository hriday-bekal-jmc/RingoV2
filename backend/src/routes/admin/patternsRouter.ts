import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../../config/db';
import { validateBody } from '../../middlewares/validate';
import { invalidateChainPreviews } from '../applicationRoutes';
import { upsertPatternSchema, type UpsertPatternBody } from '../../schemas/adminSchemas';

const router = Router();

// ─── Approval Patterns ────────────────────────────────────────────────────────

router.get('/approval-patterns', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [patterns, slots] = await Promise.all([
      query(`SELECT id, name, description, is_active FROM approval_patterns ORDER BY name ASC`),
      query(
        `SELECT aps.pattern_id, s.id AS slot_id, s.slot_code, s.label_ja, s.slot_type, s.sort_order
         FROM approval_pattern_slots aps
         JOIN approval_slots s ON s.id = aps.slot_id
         ORDER BY s.sort_order ASC`,
      ),
    ]);
    const slotsByPattern = (slots.rows as Array<{ pattern_id: string; slot_id: string; slot_code: string; label_ja: string; slot_type: string; sort_order: number }>)
      .reduce<Record<string, typeof slots.rows>>((acc, s) => {
        if (!acc[s.pattern_id]) acc[s.pattern_id] = [];
        acc[s.pattern_id].push(s);
        return acc;
      }, {});
    const result = (patterns.rows as Array<{ id: string; name: string; description: string; is_active: boolean }>).map((p) => ({
      ...p,
      slots: (slotsByPattern[p.id] ?? []).map((s: any) => ({
        slot_id: s.slot_id, slot_code: s.slot_code, label_ja: s.label_ja, slot_type: s.slot_type,
      })),
    }));
    res.json(result);
  } catch (err) {
    console.error('[admin] approval-patterns list failed:', err);
    res.status(500).json({ error: 'パターン一覧の取得に失敗しました' });
  }
});

router.post('/approval-patterns', validateBody(upsertPatternSchema), async (req: Request, res: Response): Promise<void> => {
  const { name, description, slot_ids } = req.body as UpsertPatternBody;
  try {
    await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO approval_patterns (name, description, is_active) VALUES ($1, $2, true) RETURNING id`,
        [name, description ?? null],
      );
      const patternId = (r.rows[0] as { id: string }).id;
      if (slot_ids.length > 0) {
        await client.query(
          `INSERT INTO approval_pattern_slots (pattern_id, slot_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [patternId, slot_ids],
        );
      }
    });
    res.status(201).json({ message: 'パターンを作成しました' });
  } catch (err) {
    console.error('[admin] create pattern failed:', err);
    res.status(500).json({ error: 'パターンの作成に失敗しました' });
  }
});

router.put('/approval-patterns/:id', validateBody(upsertPatternSchema), async (req: Request, res: Response): Promise<void> => {
  const { name, description, slot_ids } = req.body as UpsertPatternBody;
  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE approval_patterns SET name = $1, description = $2 WHERE id = $3`,
        [name, description ?? null, req.params.id],
      );
      await client.query(`DELETE FROM approval_pattern_slots WHERE pattern_id = $1`, [req.params.id]);
      if (slot_ids.length > 0) {
        await client.query(
          `INSERT INTO approval_pattern_slots (pattern_id, slot_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [req.params.id, slot_ids],
        );
      }
    });
    void invalidateChainPreviews(String(req.params.id));
    res.json({ message: 'パターンを更新しました' });
  } catch (err) {
    console.error('[admin] update pattern failed:', err);
    res.status(500).json({ error: 'パターンの更新に失敗しました' });
  }
});

export default router;
