-- Migration 024: application soft archive
--
-- Archive keeps legal/audit data intact but removes old completed rows from
-- hot dashboard/list queries. Direct detail views still work by id.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_apps_active_applicant_created_id
  ON applications(applicant_id, created_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_apps_active_status_created_id
  ON applications(status, created_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_apps_active_created_id
  ON applications(created_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_apps_archived_created_id
  ON applications(archived_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
