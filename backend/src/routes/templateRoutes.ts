import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';
import { getJsonCache, invalidateCachePattern, setJsonCache } from '../services/cache';

const router = Router();
router.use(requireAuth);

// 5-min Redis cache for active-templates list, keyed by user's department.
// Empty template_permissions for a template = available to ALL departments.
// Admin role bypasses dept filter (sees everything).
const TPL_CACHE_PREFIX = 'templates:active';
const TPL_CACHE_TTL    = 300;

// Wildcard delete pattern for invalidation
export async function invalidateTemplatesCache(): Promise<void> {
  await invalidateCachePattern(`${TPL_CACHE_PREFIX}:*`);
}

// GET /templates — list active templates filtered by caller's department
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const role   = req.user!.role;
  const deptId = req.user!.department_id ?? null;
  const isAdmin = isAdminUser(req.user);
  const cacheKey = `${TPL_CACHE_PREFIX}:${role}:${isAdmin ? 'admin' : 'user'}:${deptId ?? 'NULL'}`;

  try {
    const cached = await getJsonCache<unknown[]>(cacheKey);
    if (cached) { res.json(cached); return; }

    // Admin users see everything. Others see templates where either:
    //   (a) no row in template_permissions (= unrestricted), OR
    //   (b) template_permissions has a row matching user's department_id
    const sql = isAdmin
      ? `SELECT id, code, title, title_ja, pattern_id, icon, gradient, description_ja, description_en, component_type
         FROM form_templates WHERE is_active = TRUE ORDER BY title_ja`
      : `SELECT t.id, t.code, t.title, t.title_ja, t.pattern_id, t.icon, t.gradient, t.description_ja, t.description_en, t.component_type
         FROM form_templates t
         WHERE t.is_active = TRUE
           AND (
             NOT EXISTS (SELECT 1 FROM template_permissions tp WHERE tp.template_id = t.id)
             OR EXISTS (SELECT 1 FROM template_permissions tp WHERE tp.template_id = t.id AND tp.department_id = $1)
           )
         ORDER BY t.title_ja`;
    const params = isAdmin ? [] : [deptId];

    const result = await query(sql, params);
    setJsonCache(cacheKey, result.rows, TPL_CACHE_TTL);
    res.json(result.rows);
  } catch (err) {
    console.error('[templates] list failed:', err);
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// GET /templates/:code — get full template schema by code
router.get('/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.params['code'] as string;
    const result = await query(
      `SELECT id, code, title, title_ja, pattern_id, schema_definition, settlement_schema,
              component_type, icon, gradient, description_ja, description_en
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
