-- Auto-archive scan support.
--
-- The nightly auto-archive job scans for terminal applications that became
-- terminal longer than the retention window ago:
--   WHERE archived_at IS NULL
--     AND status IN ('COMPLETED','REJECTED','CANCELLED')
--     AND COALESCE(completed_at, submitted_at, created_at) < <cutoff>
--
-- Age is measured from a STABLE timestamp — completed_at (set once at
-- completion), falling back to submitted_at / created_at for REJECTED /
-- CANCELLED. NOT updated_at: a BEFORE UPDATE trigger (touch_updated_at)
-- unconditionally bumps updated_at = now() on every write, so it can't
-- represent "finished N days ago".
--
-- This partial expression index matches that predicate + ORDER BY exactly. It
-- stays tiny (only *active terminal* rows are indexed), so the daily scan is an
-- index range scan, never a seq scan, regardless of total table size.

DROP INDEX IF EXISTS idx_apps_archive_scan;

CREATE INDEX IF NOT EXISTS idx_apps_archive_scan
  ON applications ((COALESCE(completed_at, submitted_at, created_at)))
  WHERE archived_at IS NULL
    AND status IN ('COMPLETED', 'REJECTED', 'CANCELLED');
