-- Per-template application number sequences with configurable prefix and digit padding.
-- Replaces the global application_number_seq for new applications.
--
-- Sequence is keyed on (template_id, year, prefix) so changing prefix starts
-- a fresh counter at 1. Old apps keep their historical numbers via COALESCE.

-- Add prefix + digit padding to form_templates
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS app_number_prefix  VARCHAR(10) NOT NULL DEFAULT 'RNG',
  ADD COLUMN IF NOT EXISTS app_number_digits  INT         NOT NULL DEFAULT 6;

-- Per-template per-year per-prefix sequence counter
-- prefix in PK: changing prefix starts fresh at 1, old prefix counter preserved
CREATE TABLE IF NOT EXISTS application_number_sequences (
  template_id  UUID         NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  year         INT          NOT NULL,
  prefix       VARCHAR(10)  NOT NULL DEFAULT 'RNG',
  last_seq     INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, year, prefix)
);

CREATE INDEX IF NOT EXISTS idx_app_num_seq_lookup
  ON application_number_sequences(template_id, year, prefix);

-- Seed existing per-template per-year counts under the current prefix ('RNG')
-- so existing apps' numbering continues unbroken after migration
INSERT INTO application_number_sequences (template_id, year, prefix, last_seq)
SELECT
  ft.id                                   AS template_id,
  EXTRACT(YEAR FROM a.created_at)::INT    AS year,
  COALESCE(ft.app_number_prefix, 'RNG')   AS prefix,
  COUNT(*)::INT                            AS last_seq
FROM applications a
JOIN form_templates ft ON ft.id = a.template_id
WHERE a.template_id IS NOT NULL
  AND a.status != 'DRAFT'
GROUP BY ft.id, ft.app_number_prefix, EXTRACT(YEAR FROM a.created_at)
ON CONFLICT (template_id, year, prefix) DO UPDATE
  SET last_seq = EXCLUDED.last_seq;
