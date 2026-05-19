// Form template management — admin can create/edit forms with full versioning.
//
// Versioning model:
//   - form_templates       — canonical row per template code (BUSINESS_TRIP, etc.)
//   - form_template_versions — every saved schema version, immutable
//   - applications.template_version_id — locks app to a version forever
//
// Admin edits → new version inserted, old version stays. Existing applications
// keep their old version intact. Rollback = mark an old version as active.

import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { requireAdmin, requireAuth } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';
import { invalidateTemplatesCache } from './templateRoutes';
import { invalidateAdminReferenceCache } from '../services/adminReferenceCache';
import { emitAll } from './sseRoutes';
import type pg from 'pg';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);
router.use(mutationLimiter);

// ── GET /admin/form-templates ── list all w/ active version summary ──────────
router.get('/form-templates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT
         t.id, t.code, t.title, t.title_ja, t.pattern_id, t.is_active,
         t.icon, t.gradient, t.description_ja, t.description_en,
         t.app_number_prefix, t.app_number_digits,
         t.created_at, t.updated_at,
         v.id              AS active_version_id,
         v.version_number  AS active_version_number,
         v.created_at      AS active_version_created_at,
         (SELECT COUNT(*)::int FROM form_template_versions WHERE template_id = t.id) AS version_count,
         (SELECT COUNT(*)::int FROM applications WHERE template_id = t.id) AS application_count
       FROM form_templates t
       LEFT JOIN form_template_versions v
         ON v.template_id = t.id AND v.is_active = TRUE
       ORDER BY t.code`,
      [],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin/forms] list failed:', err);
    res.status(500).json({ error: 'フォーム一覧の取得に失敗しました' });
  }
});

// ── GET /admin/form-templates/:id ── single template with all versions ───────
router.get('/form-templates/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tmpl = await query(
      `SELECT id, code, title, title_ja, pattern_id, is_active,
              icon, gradient, description_ja, description_en,
              app_number_prefix, app_number_digits,
              created_at, updated_at
       FROM form_templates WHERE id = $1`,
      [req.params.id],
    );
    if (tmpl.rows.length === 0) {
      res.status(404).json({ error: 'テンプレートが見つかりません' });
      return;
    }

    // Departments allowed to use this template
    const depts = await query(
      `SELECT department_id FROM template_permissions WHERE template_id = $1`,
      [req.params.id],
    );

    const versions = await query(
      `SELECT
         v.id, v.version_number, v.schema_definition, v.settlement_schema,
         v.is_active, v.notes, v.created_at,
         (SELECT COUNT(*)::int FROM applications a WHERE a.template_version_id = v.id) AS application_count,
         u.full_name AS created_by_name
       FROM form_template_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.template_id = $1
       ORDER BY v.version_number DESC`,
      [req.params.id],
    );

    res.json({
      template:    tmpl.rows[0],
      versions:    versions.rows,
      // Allowed dept IDs — empty array means "all departments allowed"
      allowed_dept_ids: depts.rows.map((r: any) => r.department_id),
    });
  } catch (err) {
    console.error('[admin/forms] get failed:', err);
    res.status(500).json({ error: 'テンプレートの取得に失敗しました' });
  }
});

// ── POST /admin/form-templates ── create new template (with v1 schema) ───────
router.post('/form-templates', async (req: Request, res: Response): Promise<void> => {
  const {
    code, title, title_ja, pattern_id,
    icon, gradient, description_ja, description_en,
    schema_definition, settlement_schema, notes,
  } = req.body as {
    code: string;
    title: string;
    title_ja: string;
    pattern_id: number;
    icon?: string;
    gradient?: string;
    description_ja?: string;
    description_en?: string;
    schema_definition: unknown;
    settlement_schema?: unknown;
    notes?: string;
  };

  if (!code || !title_ja || !pattern_id || !schema_definition) {
    res.status(400).json({ error: 'code / title_ja / pattern_id / schema_definition は必須です' });
    return;
  }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Insert template
      const t = await client.query(
        `INSERT INTO form_templates
           (code, title, title_ja, pattern_id, icon, gradient, description_ja, description_en,
            schema_definition, settlement_schema, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
         RETURNING id, code, title_ja`,
        [
          code, title ?? title_ja, title_ja, pattern_id,
          icon ?? '📋', gradient ?? 'from-slate-400 to-slate-500',
          description_ja ?? null, description_en ?? null,
          JSON.stringify(schema_definition),
          settlement_schema ? JSON.stringify(settlement_schema) : null,
        ],
      );
      const templateId = t.rows[0].id;

      // Insert v1
      const v = await client.query(
        `INSERT INTO form_template_versions
           (template_id, version_number, schema_definition, settlement_schema, is_active, notes, created_by)
         VALUES ($1, 1, $2, $3, TRUE, $4, $5)
         RETURNING id, version_number`,
        [templateId, JSON.stringify(schema_definition), settlement_schema ? JSON.stringify(settlement_schema) : null, notes ?? 'Initial version', req.user!.id],
      );

      return { template: t.rows[0], version: v.rows[0] };
    });

    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: (result as { template: { id: string } }).template.id });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') { // unique violation on code
      res.status(409).json({ error: 'このコードは既に使われています' });
      return;
    }
    console.error('[admin/forms] create failed:', err);
    res.status(500).json({ error: 'フォーム作成に失敗しました' });
  }
});

// ── PATCH /admin/form-templates/:id ── update title/code metadata only ───────
// (Schema edits go through /versions endpoint to keep history intact)
router.patch('/form-templates/:id', async (req: Request, res: Response): Promise<void> => {
  const { title, title_ja, is_active, pattern_id, icon, gradient, description_ja, description_en, app_number_prefix, app_number_digits } = req.body as {
    title?: string; title_ja?: string; is_active?: boolean; pattern_id?: number;
    icon?: string; gradient?: string; description_ja?: string; description_en?: string;
    app_number_prefix?: string; app_number_digits?: number;
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  if (title !== undefined)          { sets.push(`title = $${idx++}`);          vals.push(title); }
  if (title_ja !== undefined)       { sets.push(`title_ja = $${idx++}`);       vals.push(title_ja); }
  if (is_active !== undefined)      { sets.push(`is_active = $${idx++}`);      vals.push(is_active); }
  if (pattern_id !== undefined)     { sets.push(`pattern_id = $${idx++}`);     vals.push(pattern_id); }
  if (icon !== undefined)           { sets.push(`icon = $${idx++}`);           vals.push(icon); }
  if (gradient !== undefined)       { sets.push(`gradient = $${idx++}`);       vals.push(gradient); }
  if (description_ja !== undefined) { sets.push(`description_ja = $${idx++}`); vals.push(description_ja); }
  if (description_en !== undefined) { sets.push(`description_en = $${idx++}`); vals.push(description_en); }
  if (app_number_prefix !== undefined) {
    const clean = app_number_prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    sets.push(`app_number_prefix = $${idx++}`); vals.push(clean);
  }
  if (app_number_digits !== undefined) {
    const d = Math.max(4, Math.min(10, Number(app_number_digits)));
    sets.push(`app_number_digits = $${idx++}`); vals.push(d);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: '更新するフィールドがありません' });
    return;
  }
  vals.push(req.params.id);

  try {
    const r = await query(
      `UPDATE form_templates SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, code, title, title_ja, is_active, app_number_prefix, app_number_digits`,
      vals,
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'テンプレートが見つかりません' });
      return;
    }
    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[admin/forms] patch failed:', err);
    res.status(500).json({ error: 'テンプレートの更新に失敗しました' });
  }
});

// ── POST /admin/form-templates/:id/versions ── save new schema version ───────
// Admin edits form → creates new version + makes it active.
// Old applications keep their old version reference forever.
router.post('/form-templates/:id/versions', async (req: Request, res: Response): Promise<void> => {
  const { schema_definition, settlement_schema, notes } = req.body as {
    schema_definition: unknown;
    settlement_schema?: unknown;
    notes?: string;
  };

  if (!schema_definition) {
    res.status(400).json({ error: 'schema_definition は必須です' });
    return;
  }

  try {
    const result = await withTransaction(async (client: pg.PoolClient) => {
      // Lock template row to prevent concurrent version inserts
      const tmpl = await client.query(
        `SELECT id FROM form_templates WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      if (tmpl.rows.length === 0) {
        throw Object.assign(new Error('テンプレートが見つかりません'), { status: 404 });
      }

      // Get next version number
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_v FROM form_template_versions WHERE template_id = $1`,
        [req.params.id],
      );
      const nextVersion = Number(maxRes.rows[0].max_v) + 1;

      // Deactivate all existing versions
      await client.query(
        `UPDATE form_template_versions SET is_active = FALSE WHERE template_id = $1`,
        [req.params.id],
      );

      // Insert new active version
      const v = await client.query(
        `INSERT INTO form_template_versions
           (template_id, version_number, schema_definition, settlement_schema, is_active, notes, created_by)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6)
         RETURNING id, version_number, created_at`,
        [req.params.id, nextVersion, JSON.stringify(schema_definition), settlement_schema ? JSON.stringify(settlement_schema) : null, notes ?? null, req.user!.id],
      );

      // Sync form_templates.schema_definition to the new active version
      // (Keeps old code paths that read form_templates directly working)
      await client.query(
        `UPDATE form_templates
            SET schema_definition = $1,
                settlement_schema = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [JSON.stringify(schema_definition), settlement_schema ? JSON.stringify(settlement_schema) : null, req.params.id],
      );

      return v.rows[0];
    });

    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin/forms] new version failed:', err);
    res.status(500).json({ error: 'バージョン作成に失敗しました' });
  }
});

// ── POST /admin/form-templates/:id/versions/:vid/activate ── rollback to old ─
router.post('/form-templates/:id/versions/:vid/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      const tmpl = await client.query(
        `SELECT id FROM form_templates WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      if (tmpl.rows.length === 0) {
        throw Object.assign(new Error('テンプレートが見つかりません'), { status: 404 });
      }

      const v = await client.query(
        `SELECT id, schema_definition, settlement_schema, version_number
         FROM form_template_versions
         WHERE id = $1 AND template_id = $2`,
        [req.params.vid, req.params.id],
      );
      if (v.rows.length === 0) {
        throw Object.assign(new Error('バージョンが見つかりません'), { status: 404 });
      }

      // Deactivate all
      await client.query(
        `UPDATE form_template_versions SET is_active = FALSE WHERE template_id = $1`,
        [req.params.id],
      );

      // Activate target
      await client.query(
        `UPDATE form_template_versions SET is_active = TRUE WHERE id = $1`,
        [req.params.vid],
      );

      // Sync canonical row
      await client.query(
        `UPDATE form_templates
            SET schema_definition = $1,
                settlement_schema = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [JSON.stringify(v.rows[0].schema_definition), v.rows[0].settlement_schema ? JSON.stringify(v.rows[0].settlement_schema) : null, req.params.id],
      );
    });

    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
    res.json({ message: 'バージョンを切り替えました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin/forms] activate failed:', err);
    res.status(500).json({ error: 'バージョン切替に失敗しました' });
  }
});

// ── PUT /admin/form-templates/:id/departments ── set allowed departments ─────
// Body: { department_ids: string[] }. Empty array = available to all departments.
router.put('/form-templates/:id/departments', async (req: Request, res: Response): Promise<void> => {
  const { department_ids } = req.body as { department_ids?: string[] };
  if (!Array.isArray(department_ids)) {
    res.status(400).json({ error: 'department_ids must be an array' });
    return;
  }
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      await client.query(`DELETE FROM template_permissions WHERE template_id = $1`, [req.params.id]);
      for (const deptId of department_ids) {
        await client.query(
          `INSERT INTO template_permissions (template_id, department_id, requirement_level)
           VALUES ($1, $2, 'MUST')
           ON CONFLICT DO NOTHING`,
          [req.params.id, deptId],
        );
      }
    });
    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
    res.json({ message: '部署設定を更新しました' });
  } catch (err) {
    console.error('[admin/forms] dept permissions failed:', err);
    res.status(500).json({ error: '部署設定の更新に失敗しました' });
  }
});

// ── DELETE /admin/form-templates/:id/versions/:vid ── delete old version ─────
// Blocked if version is currently active or any application references it.
router.delete('/form-templates/:id/versions/:vid', async (req: Request, res: Response): Promise<void> => {
  try {
    await withTransaction(async (client: pg.PoolClient) => {
      const v = await client.query(
        `SELECT is_active FROM form_template_versions
         WHERE id = $1 AND template_id = $2
         FOR UPDATE`,
        [req.params.vid, req.params.id],
      );
      if (v.rows.length === 0) {
        throw Object.assign(new Error('バージョンが見つかりません'), { status: 404 });
      }
      if (v.rows[0].is_active) {
        throw Object.assign(new Error('有効なバージョンは削除できません'), { status: 409 });
      }
      const refs = await client.query(
        `SELECT COUNT(*)::int AS n FROM applications WHERE template_version_id = $1`,
        [req.params.vid],
      );
      if (refs.rows[0].n > 0) {
        throw Object.assign(
          new Error(`このバージョンは ${refs.rows[0].n} 件の申請で使用されているため削除できません`),
          { status: 409 },
        );
      }
      await client.query(`DELETE FROM form_template_versions WHERE id = $1`, [req.params.vid]);
    });
    res.json({ message: 'バージョンを削除しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin/forms] delete version failed:', err);
    res.status(500).json({ error: 'バージョン削除に失敗しました' });
  }
});

// ── DELETE /admin/form-templates/:id ── soft delete (default) ────────────────
// Sets is_active=FALSE. Pass ?hard=true to attempt full delete (blocked if any
// applications reference this template).
router.delete('/form-templates/:id', async (req: Request, res: Response): Promise<void> => {
  const hard = req.query.hard === 'true';
  try {
    if (!hard) {
      const r = await query(
        `UPDATE form_templates SET is_active = FALSE WHERE id = $1 RETURNING id`,
        [req.params.id],
      );
      if (r.rows.length === 0) {
        res.status(404).json({ error: 'テンプレートが見つかりません' });
        return;
      }
      void invalidateTemplatesCache();
      void invalidateAdminReferenceCache('templates', 'routes');
      emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
      res.json({ message: 'テンプレートを無効化しました' });
      return;
    }

    // Hard delete — requires zero applications referencing this template
    await withTransaction(async (client: pg.PoolClient) => {
      const refs = await client.query(
        `SELECT COUNT(*)::int AS n FROM applications WHERE template_id = $1`,
        [req.params.id],
      );
      if (refs.rows[0].n > 0) {
        throw Object.assign(
          new Error(`このフォームは ${refs.rows[0].n} 件の申請で使用されているため削除できません（先に無効化のみ可能）`),
          { status: 409 },
        );
      }
      // ON DELETE CASCADE handles form_template_versions, template_permissions, approval_routes
      const r = await client.query(`DELETE FROM form_templates WHERE id = $1 RETURNING id`, [req.params.id]);
      if (r.rows.length === 0) {
        throw Object.assign(new Error('テンプレートが見つかりません'), { status: 404 });
      }
    });
    void invalidateTemplatesCache();
    void invalidateAdminReferenceCache('templates', 'routes');
    emitAll('TEMPLATE_UPDATED', { templateId: req.params.id });
    res.json({ message: 'テンプレートを完全削除しました' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[admin/forms] delete failed:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

export default router;
