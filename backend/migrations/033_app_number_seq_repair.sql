-- Repair migration: application_number_sequences must include `prefix` in PK.
--
-- Migration 031 was edited after first deploy to add `prefix` to the PK.
-- Installations that already applied the original 031 have the old schema
-- (PK = template_id, year, no prefix column) and won't re-run 031.
-- This migration brings them up to the current schema. Idempotent — safe
-- to run on fresh installs (031 already created the new schema; this is no-op).

DO $$
DECLARE
  has_prefix_col BOOLEAN;
BEGIN
  -- Add `prefix` column if missing
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'application_number_sequences' AND column_name = 'prefix'
  ) INTO has_prefix_col;

  IF NOT has_prefix_col THEN
    -- Add column with default so existing rows get a value
    ALTER TABLE application_number_sequences
      ADD COLUMN prefix VARCHAR(10) NOT NULL DEFAULT 'RNG';

    -- Backfill prefix from each row's current template prefix so existing
    -- counters stay associated with the prefix that produced them
    UPDATE application_number_sequences s
       SET prefix = COALESCE(ft.app_number_prefix, 'RNG')
      FROM form_templates ft
     WHERE ft.id = s.template_id;

    -- Drop old PK and recreate with prefix included
    ALTER TABLE application_number_sequences DROP CONSTRAINT application_number_sequences_pkey;
    ALTER TABLE application_number_sequences
      ADD CONSTRAINT application_number_sequences_pkey
      PRIMARY KEY (template_id, year, prefix);

    -- Replace any old index that didn't include prefix
    DROP INDEX IF EXISTS idx_app_num_seq_template_year;
    CREATE INDEX IF NOT EXISTS idx_app_num_seq_lookup
      ON application_number_sequences(template_id, year, prefix);
  END IF;
END $$;
