-- Migration 025: dashboard status-count index
--
-- Optimizes /dashboard/summary:
--   SELECT status, COUNT(*)
--   FROM applications
--   WHERE applicant_id = $1 AND archived_at IS NULL
--   GROUP BY status;
--
-- The partial predicate keeps archived history out of the hot index.

CREATE INDEX IF NOT EXISTS idx_apps_active_applicant_status
  ON applications(applicant_id, status)
  WHERE archived_at IS NULL;
