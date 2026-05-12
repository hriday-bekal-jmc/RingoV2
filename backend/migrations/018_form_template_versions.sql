-- Migration 018: form template versioning
--
-- Goal: admin can edit/create forms without touching code. Each edit creates
-- a new version. Existing applications keep pointing to the version they
-- were submitted under — schema changes never break old submissions.
--
-- Pattern:
--   form_templates       — pointer to the "active version" (one row per template code)
--   form_template_versions — every saved version (immutable once apps reference it)
--   applications.template_version_id — locks each app to a version
--
-- Backfill strategy:
--   1. Create v1 row in form_template_versions for every existing template,
--      copying schema_definition + settlement_schema from form_templates.
--   2. Backfill applications.template_version_id to point at that v1 row.
--   3. Future edits via admin → insert new version row, flip is_active.

CREATE TABLE IF NOT EXISTS form_template_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  version_number      INT NOT NULL,
  schema_definition   JSONB NOT NULL,
  settlement_schema   JSONB,
  is_active           BOOLEAN DEFAULT FALSE,
  notes               TEXT,                              -- admin's reason for change
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_template_active
  ON form_template_versions(template_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_form_versions_template_order
  ON form_template_versions(template_id, version_number DESC);

-- Add version reference to applications
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS template_version_id UUID
  REFERENCES form_template_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apps_template_version
  ON applications(template_version_id);

-- ── Backfill: create v1 from current form_templates for every template ────
DO $$
DECLARE
  tmpl RECORD;
  new_version_id UUID;
BEGIN
  FOR tmpl IN SELECT id, schema_definition, settlement_schema FROM form_templates
  LOOP
    -- Skip if already has a version (idempotent re-run)
    IF EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = tmpl.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO form_template_versions
      (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
    VALUES
      (tmpl.id, 1, tmpl.schema_definition, tmpl.settlement_schema, TRUE, 'Initial version (auto-migrated from form_templates)')
    RETURNING id INTO new_version_id;

    -- Backfill all applications using this template
    UPDATE applications
       SET template_version_id = new_version_id
     WHERE template_id = tmpl.id
       AND template_version_id IS NULL;

    RAISE NOTICE 'Created v1 for template %: %', tmpl.id, new_version_id;
  END LOOP;
END $$;
