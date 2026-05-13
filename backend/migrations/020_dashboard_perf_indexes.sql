-- Migration 020: dashboard/read-path production indexes
--
-- These cover hot dashboard/sidebar reads that are cheap on local seed data but
-- can become sort-heavy as applications and approval_steps grow.

-- /dashboard/summary recent_apps:
--   WHERE applicant_id = $1 ORDER BY created_at DESC LIMIT 5
CREATE INDEX IF NOT EXISTS idx_apps_applicant_created
  ON applications(applicant_id, created_at DESC);

-- /dashboard/admin-overview recent_activity:
--   ORDER BY created_at DESC LIMIT 5
CREATE INDEX IF NOT EXISTS idx_apps_created
  ON applications(created_at DESC);

-- /dashboard/summary pending_approvals:
--   WHERE approver_id = $1 AND status = 'PENDING'
--   ORDER BY created_at ASC LIMIT 5
-- /approvals/pending/count also benefits from the same small partial index.
CREATE INDEX IF NOT EXISTS idx_steps_pending_approver_created
  ON approval_steps(approver_id, created_at ASC)
  WHERE status = 'PENDING';
