-- Per-template application number sequences with configurable prefix and digit padding.
-- Replaces the global application_number_seq for new applications.

-- Add prefix + digit padding to form_templates
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS app_number_prefix  VARCHAR(10) NOT NULL DEFAULT 'RNG',
  ADD COLUMN IF NOT EXISTS app_number_digits  INT         NOT NULL DEFAULT 6;

-- Per-template per-year sequence counter
CREATE TABLE IF NOT EXISTS application_number_sequences (
  template_id  UUID    NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  year         INT     NOT NULL,
  last_seq     INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, year)
);

CREATE INDEX IF NOT EXISTS idx_app_num_seq_template_year
  ON application_number_sequences(template_id, year);

-- Seed existing templates to 'RNG' prefix (already the default, just explicit)
UPDATE form_templates SET app_number_prefix = 'RNG' WHERE app_number_prefix = 'RNG';

-- Seed existing per-template per-year counts so numbering continues from current max
INSERT INTO application_number_sequences (template_id, year, last_seq)
SELECT
  a.template_id,
  EXTRACT(YEAR FROM a.created_at)::INT AS year,
  COUNT(*)::INT                         AS last_seq
FROM applications a
WHERE a.template_id IS NOT NULL
  AND a.status != 'DRAFT'
GROUP BY a.template_id, EXTRACT(YEAR FROM a.created_at)
ON CONFLICT (template_id, year) DO UPDATE
  SET last_seq = EXCLUDED.last_seq;
