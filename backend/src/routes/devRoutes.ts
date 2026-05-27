// ── DEV-ONLY i18n overrides editor ───────────────────────────────────────────
// Gated by email (h-bekal@jmc-ltd.co.jp). Reads/writes
// frontend/src/i18n.overrides.json so the dev page can manage translations
// without touching the main dict.
//
// Production cleanup: delete this file + remove the 2 lines in server.ts
// (import devRoutes / app.use('/api/dev', devRoutes)).
//
// Why path goes outside backend/: dev workflow runs both packages from the
// monorepo root; in prod the frontend is built ahead of time and this file
// is never accessed, so the relative path is fine.

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '../middlewares/authMiddleware';
import { query, withTransaction } from '../config/db';
import { RESOLVE_SOURCES, invalidateVarOverrideCache } from '../services/notificationService';
import type pg from 'pg';

const DEV_EMAIL = 'h-bekal@jmc-ltd.co.jp';
const OVERRIDES_PATH       = path.resolve(__dirname, '../../../frontend/src/i18n.overrides.json');
const NOTIFY_VARS_OVERRIDE = path.resolve(__dirname, '../../../frontend/src/config/notificationVars.overrides.json');

function requireDev(req: Request, res: Response, next: NextFunction): void {
  const email = (req.user?.email ?? '').toLowerCase();
  if (email !== DEV_EMAIL) {
    res.status(404).json({ error: 'Not found' });   // 404 not 403 — hide existence
    return;
  }
  next();
}

const router = Router();
router.use(requireAuth);
router.use(requireDev);

interface Overrides {
  ja: Record<string, string>;
  en: Record<string, string>;
}

async function readOverrides(): Promise<Overrides> {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Overrides>;
    return { ja: parsed.ja ?? {}, en: parsed.en ?? {} };
  } catch {
    return { ja: {}, en: {} };
  }
}

async function writeOverrides(data: Overrides): Promise<void> {
  // 2-space indent + trailing newline keeps git diffs clean
  await fs.writeFile(OVERRIDES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// GET /api/dev/i18n — read current overrides
router.get('/i18n', async (_req: Request, res: Response) => {
  try {
    const data = await readOverrides();
    res.json(data);
  } catch (err) {
    console.error('[dev/i18n] read failed:', err);
    res.status(500).json({ error: 'Failed to read overrides' });
  }
});

// PUT /api/dev/i18n — replace full overrides JSON
// Body: { ja: {key: value, ...}, en: {key: value, ...} }
router.put('/i18n', async (req: Request, res: Response) => {
  const body = req.body as Partial<Overrides>;
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: 'Body must be JSON object { ja, en }' });
    return;
  }
  const cleaned: Overrides = {
    ja: typeof body.ja === 'object' && body.ja ? body.ja : {},
    en: typeof body.en === 'object' && body.en ? body.en : {},
  };
  // Validate all values are strings
  for (const lang of ['ja', 'en'] as const) {
    for (const [k, v] of Object.entries(cleaned[lang])) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        res.status(400).json({ error: `Invalid entry in ${lang}: ${k}` });
        return;
      }
    }
  }
  try {
    await writeOverrides(cleaned);
    res.json({ ok: true, count: { ja: Object.keys(cleaned.ja).length, en: Object.keys(cleaned.en).length } });
  } catch (err) {
    console.error('[dev/i18n] write failed:', err);
    res.status(500).json({ error: 'Failed to write overrides' });
  }
});

// ── DB-string translations ───────────────────────────────────────────────────
// Surfaces every JA/EN pair stored in form_templates so the dev page can fill
// missing EN translations. Covers: template title, description, and every
// field label (incl. options + repeat-group children) inside schema_definition
// and settlement_schema. Writes back to form_templates AND the active version
// row (so newly-submitted apps capture the new EN at submit time).

interface DbStringItem {
  path: string;       // e.g. "title", "description", "schema.fields[0].label"
  ja: string;
  en: string;
}
interface DbStringTemplate {
  template_id: string;
  code: string;
  items: DbStringItem[];
}

interface SchemaField {
  label?: string;
  label_en?: string | null;
  placeholder?: string;
  add_label?: string;
  add_label_en?: string;
  options?: { value: string; label_ja?: string; label_en?: string }[];
  fields?: SchemaField[];   // repeat-group children
  [k: string]: unknown;
}

function walkFields(
  fields: SchemaField[] | undefined,
  prefix: string,
  out: DbStringItem[],
): void {
  if (!Array.isArray(fields)) return;
  fields.forEach((f, i) => {
    const base = `${prefix}.fields[${i}]`;
    if (typeof f.label === 'string') {
      out.push({ path: `${base}.label`, ja: f.label, en: f.label_en ?? '' });
    }
    if (typeof f.add_label === 'string') {
      out.push({ path: `${base}.add_label`, ja: f.add_label, en: f.add_label_en ?? '' });
    }
    if (Array.isArray(f.options)) {
      f.options.forEach((o, oi) => {
        out.push({
          path: `${base}.options[${oi}].label`,
          ja: o.label_ja ?? '',
          en: o.label_en ?? '',
        });
      });
    }
    if (Array.isArray(f.fields)) {
      walkFields(f.fields, base, out);
    }
  });
}

function buildItems(row: {
  title: string; title_ja: string | null;
  description_ja: string | null; description_en: string | null;
  schema_definition: { fields?: SchemaField[] } | null;
  settlement_schema: { fields?: SchemaField[] } | null;
}): DbStringItem[] {
  const items: DbStringItem[] = [];
  items.push({ path: 'title', ja: row.title_ja ?? '', en: row.title ?? '' });
  items.push({ path: 'description', ja: row.description_ja ?? '', en: row.description_en ?? '' });
  walkFields(row.schema_definition?.fields, 'schema', items);
  walkFields(row.settlement_schema?.fields, 'settle', items);
  return items;
}

// Deep-set EN value at path. Mutates `template` in place. Returns true if applied.
function applyEnUpdate(
  template: {
    title: string;
    description_en: string | null;
    schema_definition: { fields?: SchemaField[] } | null;
    settlement_schema: { fields?: SchemaField[] } | null;
  },
  path: string,
  en: string,
): boolean {
  if (path === 'title') { template.title = en || template.title; return true; }
  if (path === 'description') { template.description_en = en || null; return true; }

  // Parse path like "schema.fields[0].options[2].label" or "schema.fields[1].fields[0].label"
  const root = path.startsWith('schema.') ? 'schema' : path.startsWith('settle.') ? 'settle' : null;
  if (!root) return false;
  const rest = path.slice(root.length + 1);
  const tokens = rest.match(/[a-z_]+(?:\[\d+\])?/g);
  if (!tokens) return false;

  const container = root === 'schema' ? template.schema_definition : template.settlement_schema;
  if (!container || !Array.isArray(container.fields)) return false;

  // Walk tokens, last token is the leaf property
  let node: any = container;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    const m = tok.match(/^([a-z_]+)(?:\[(\d+)\])?$/);
    if (!m) return false;
    const [, key, idxStr] = m;
    node = node?.[key];
    if (idxStr != null) {
      const idx = Number(idxStr);
      node = node?.[idx];
    }
    if (!node) return false;
  }

  const leafTok = tokens[tokens.length - 1];
  const lm = leafTok.match(/^([a-z_]+)(?:\[(\d+)\])?$/);
  if (!lm) return false;
  const [, leafKey] = lm;
  // Map JA leaf key → EN sibling key
  let enKey: string;
  if (leafKey === 'label') {
    // options[N].label JA lives at .label_ja, EN at .label_en (set both ja+en handled by caller)
    // field label JA lives at .label, EN at .label_en
    // Detect: if path includes "options[" before this leaf, it's an option
    enKey = path.includes('.options[') ? 'label_en' : 'label_en';
  } else if (leafKey === 'add_label') {
    enKey = 'add_label_en';
  } else {
    return false;
  }
  node[enKey] = en || '';
  return true;
}

// GET /api/dev/db-strings — list all templates' JA/EN pairs
router.get('/db-strings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT id, code, title, title_ja, description_ja, description_en,
              schema_definition, settlement_schema
       FROM form_templates
       WHERE is_active = TRUE
       ORDER BY code`,
    );
    const templates: DbStringTemplate[] = r.rows.map((row: any) => ({
      template_id: row.id,
      code: row.code,
      items: buildItems(row),
    }));
    res.json({ templates });
  } catch (err) {
    console.error('[dev/db-strings] read failed:', err);
    res.status(500).json({ error: 'Failed to read DB strings' });
  }
});

// PUT /api/dev/db-strings — batch update EN values across templates
// Body: { updates: [{ template_id, path, en }, ...] }
router.put('/db-strings', async (req: Request, res: Response): Promise<void> => {
  const { updates } = req.body as { updates?: { template_id: string; path: string; en: string }[] };
  if (!Array.isArray(updates)) {
    res.status(400).json({ error: 'Body must be { updates: [...] }' });
    return;
  }
  try {
    // Group updates by template_id to minimise DB round-trips
    const byTemplate = new Map<string, { path: string; en: string }[]>();
    for (const u of updates) {
      if (!u?.template_id || typeof u.path !== 'string' || typeof u.en !== 'string') continue;
      if (!byTemplate.has(u.template_id)) byTemplate.set(u.template_id, []);
      byTemplate.get(u.template_id)!.push({ path: u.path, en: u.en });
    }

    let appliedCount = 0;
    let templateCount = 0;

    await withTransaction(async (client: pg.PoolClient) => {
      for (const [templateId, entries] of byTemplate) {
        const r = await client.query(
          `SELECT id, title, title_ja, description_ja, description_en,
                  schema_definition, settlement_schema
           FROM form_templates WHERE id = $1 FOR UPDATE`,
          [templateId],
        );
        if (r.rows.length === 0) continue;
        const row = r.rows[0];
        // Deep-clone JSONB so we don't mutate Postgres-bound objects
        const tmpl = {
          title: row.title,
          description_en: row.description_en,
          schema_definition: row.schema_definition ? JSON.parse(JSON.stringify(row.schema_definition)) : null,
          settlement_schema: row.settlement_schema ? JSON.parse(JSON.stringify(row.settlement_schema)) : null,
        };
        for (const { path, en } of entries) {
          if (applyEnUpdate(tmpl, path, en)) appliedCount++;
        }
        await client.query(
          `UPDATE form_templates
             SET title             = $2,
                 description_en    = $3,
                 schema_definition = $4::jsonb,
                 settlement_schema = $5::jsonb,
                 updated_at        = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            templateId,
            tmpl.title,
            tmpl.description_en,
            JSON.stringify(tmpl.schema_definition ?? null),
            JSON.stringify(tmpl.settlement_schema ?? null),
          ],
        );
        // Mirror onto the active version row so newly-locked submissions get the new EN
        await client.query(
          `UPDATE form_template_versions
             SET schema_definition = $2::jsonb,
                 settlement_schema = $3::jsonb
           WHERE template_id = $1 AND is_active = TRUE`,
          [
            templateId,
            JSON.stringify(tmpl.schema_definition ?? null),
            JSON.stringify(tmpl.settlement_schema ?? null),
          ],
        );
        templateCount++;
      }
    });

    res.json({ ok: true, applied: appliedCount, templates: templateCount });
  } catch (err) {
    console.error('[dev/db-strings] write failed:', err);
    res.status(500).json({ error: 'Failed to update DB strings' });
  }
});

// ── Notification variable definitions ────────────────────────────────────────
// Stores user-added/edited var metadata in notificationVars.overrides.json.
// Frontend merges with its hardcoded baseline at runtime.

interface NotifyVarEntry {
  key:     string;
  labelJa: string;
  labelEn: string;
  descJa:  string;
  group:   string;
  resolve?: { source: string; field: string; fallback?: string };
}
interface NotifyVarsOverride { vars: NotifyVarEntry[] }

async function readNotifyVarsOverride(): Promise<NotifyVarsOverride> {
  try {
    const raw = await fs.readFile(NOTIFY_VARS_OVERRIDE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<NotifyVarsOverride>;
    return { vars: Array.isArray(parsed.vars) ? parsed.vars : [] };
  } catch {
    return { vars: [] };
  }
}

async function writeNotifyVarsOverride(data: NotifyVarsOverride): Promise<void> {
  await fs.writeFile(NOTIFY_VARS_OVERRIDE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// GET /api/dev/notify-vars — read overrides (dev only writes, but all admins can read via /admin)
router.get('/notify-vars', async (_req: Request, res: Response) => {
  try {
    res.json(await readNotifyVarsOverride());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read notify-vars overrides' });
  }
});

// PUT /api/dev/notify-vars — replace full overrides
router.put('/notify-vars', async (req: Request, res: Response) => {
  const body = req.body as Partial<NotifyVarsOverride>;
  if (!Array.isArray(body?.vars)) {
    res.status(400).json({ error: 'Body must be { vars: [...] }' });
    return;
  }
  // Validate each entry + optional resolve config
  for (const v of body.vars) {
    if (typeof v.key !== 'string' || !v.key.trim()) {
      res.status(400).json({ error: 'Each var must have a non-empty key' });
      return;
    }
    if (v.resolve) {
      if (!RESOLVE_SOURCES[v.resolve.source]) {
        res.status(400).json({ error: `Unknown resolve source: ${v.resolve.source}` });
        return;
      }
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v.resolve.field)) {
        res.status(400).json({ error: `Invalid field name: ${v.resolve.field}` });
        return;
      }
    }
  }
  try {
    const clean: NotifyVarsOverride = { vars: body.vars };
    await writeNotifyVarsOverride(clean);
    invalidateVarOverrideCache();   // flush 30s in-process cache immediately
    res.json({ ok: true, count: clean.vars.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write notify-vars overrides' });
  }
});

// GET /api/dev/resolve-sources — allowed source table list for UI picker
router.get('/resolve-sources', (_req: Request, res: Response) => {
  const sources = Object.entries(RESOLVE_SOURCES).map(([key, cfg]) => ({
    key,
    label:      cfg.label,
    hintFields: cfg.hintFields,
  }));
  res.json({ sources });
});

// GET /api/dev/resolve-preview?source=<source>
// Returns actual DB values for each hint field using the most recent application.
// Powers the column-picker UI — dev sees real data, not just column names.
router.get('/resolve-preview', async (req: Request, res: Response): Promise<void> => {
  const { source } = req.query as { source?: string };
  if (!source || !RESOLVE_SOURCES[source]) {
    res.status(400).json({ error: `Unknown source: ${source ?? '(empty)'}` });
    return;
  }
  const src = RESOLVE_SOURCES[source];
  try {
    // Most recent application — gives representative data
    const recent = await query(`SELECT id FROM applications ORDER BY created_at DESC LIMIT 1`);
    if (recent.rows.length === 0) {
      res.json({ values: {}, note: 'No applications in DB yet' });
      return;
    }
    const appId: string = recent.rows[0].id;

    // Only allow safe field names (already guaranteed by hintFields whitelist, but re-check)
    const safeFields = src.hintFields.filter((f: string) => /^[a-z_][a-z0-9_]{0,62}$/.test(f));
    if (safeFields.length === 0) { res.json({ values: {}, app_id: appId }); return; }

    const selects   = safeFields.map((f: string) => `${src.alias}.${f}::text AS "${f}"`);
    const extraJoin = src.join ?? '';

    const r = await query(
      `SELECT ${selects.join(', ')}
       FROM applications a
       JOIN users u           ON u.id  = a.applicant_id
       JOIN form_templates ft ON ft.id = a.template_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${extraJoin}
       WHERE a.id = $1`,
      [appId],
    );
    res.json({ values: (r.rows[0] ?? {}) as Record<string, string | null>, app_id: appId });
  } catch (err) {
    console.error('[dev/resolve-preview] failed:', err);
    res.status(500).json({ error: 'Preview query failed' });
  }
});

export default router;
