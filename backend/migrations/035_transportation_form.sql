-- Migration 035: Transportation expense form (交通費精算)
--
-- Adds:
--   • allowance_rates table     — role → daily_rate_yen lookup (admin-editable)
--   • users.daily_allowance_rate — cached per-user rate (synced from allowance_rates)
--   • form_templates.component_type — 'transportation' triggers custom renderer
--   • form_templates.is_protected   — TRUE = deactivate-only (no hard delete)
--   • TRANSPORT_EXPENSE template seed (pattern_id=2, settlement-only, is_protected=TRUE)

-- 1. allowance_rates — role-keyed daily rate table
CREATE TABLE IF NOT EXISTS allowance_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            VARCHAR(32) NOT NULL UNIQUE,
  daily_rate_yen  INT NOT NULL CHECK (daily_rate_yen >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed by system roles (yen/day). ON CONFLICT makes re-run safe.
INSERT INTO allowance_rates (role, daily_rate_yen) VALUES
  ('EMPLOYEE',  2000),
  ('MANAGER',   2400),
  ('GM',        2600),
  ('SOUMU',     2200),
  ('SENMU',     2600),
  ('PRESIDENT', 2600)
ON CONFLICT (role) DO UPDATE SET daily_rate_yen = EXCLUDED.daily_rate_yen;

-- 2. Cached per-user allowance rate
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_allowance_rate INT;

-- Backfill existing users from their current role
UPDATE users u
SET daily_allowance_rate = ar.daily_rate_yen
FROM allowance_rates ar
WHERE ar.role = u.role
  AND u.daily_allowance_rate IS NULL;

-- 3. component_type — NULL = generic DynamicForm, 'transportation' = custom renderer
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS component_type VARCHAR(50);

-- 4. is_protected — TRUE = admin can deactivate but never hard-delete
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Seed TRANSPORT_EXPENSE form template
-- pattern_id=2 → PATTERN_2 (settlement-only, no separate ringi approval chain)
-- schema_definition: only the title header field; custom renderer handles entries
-- settlement_schema: transfer date entered by soumu/accounting
INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, component_type, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  2,
  'TRANSPORT_EXPENSE',
  '交通費精算（出張日除く）',
  '交通費精算（出張日除く）',
  '{
    "fields": [
      {
        "name": "title",
        "label": "件名",
        "label_en": "Subject",
        "type": "text",
        "required": true,
        "placeholder": "例）2025年5月分"
      }
    ]
  }'::jsonb,
  '{
    "fields": [
      {
        "name": "transfer_date",
        "label": "振込予定日",
        "label_en": "Transfer Date",
        "type": "date",
        "required": false
      }
    ]
  }'::jsonb,
  TRUE,
  'transportation',
  TRUE,
  '🚃',
  'from-blue-400 to-indigo-500',
  '月次交通費精算（出張日除く）',
  'Monthly transportation expense (excl. business trips)',
  'TR',
  6
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'TRANSPORT_EXPENSE'
);

-- 6. Initial active version for the transportation template
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active)
SELECT
  ft.id,
  1,
  ft.schema_definition,
  ft.settlement_schema,
  TRUE
FROM form_templates ft
WHERE ft.code = 'TRANSPORT_EXPENSE'
  AND NOT EXISTS (
    SELECT 1 FROM form_template_versions fv WHERE fv.template_id = ft.id
  );
