-- Partial index covering LATERAL subqueries that resolve the active schema version
-- for a given template. Pattern used in:
--   settlementRoutes.ts  — schema lookup on settlement submit
--   applicationRoutes.ts — schema lookup on application detail / submit
--
-- Without this index Postgres does a full sequential scan on form_template_versions
-- for every settlement submission and application detail load.
-- With it: instant index-only scan (typically 8-10 rows per template × N templates).
--
-- Partial (WHERE is_active = TRUE) keeps the index tiny — only the current active
-- version per template is indexed, not historical versions.

CREATE INDEX IF NOT EXISTS idx_form_template_versions_active
  ON form_template_versions(template_id)
  WHERE is_active = TRUE;
