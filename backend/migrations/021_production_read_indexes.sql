-- Migration 021: production read-path indexes
--
-- Cursor pagination and admin search/list endpoints need deterministic
-- created_at + id ordering. These indexes keep first-page and deep-page reads
-- index-backed as applications/settlements/steps grow.

CREATE INDEX IF NOT EXISTS idx_apps_created_id
  ON applications(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_apps_status_created_id
  ON applications(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_apps_applicant_created_id
  ON applications(applicant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_settlements_created_id
  ON settlements(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_settlements_app_status_created_id
  ON settlements(application_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_steps_pending_app
  ON approval_steps(application_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_steps_app_stage_status_order
  ON approval_steps(application_id, stage, status, step_order);

CREATE INDEX IF NOT EXISTS idx_steps_acted_by_status_acted_id
  ON approval_steps(acted_by, status, acted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_templates_title_ja_trgm
  ON form_templates USING GIN (title_ja gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_apps_number_trgm
  ON applications USING GIN (application_number gin_trgm_ops);
