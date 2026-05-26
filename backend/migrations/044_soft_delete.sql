-- Migration 044: Soft-delete support for applications
-- Adds deleted_at column for future admin trash/recovery flow.
-- The DELETE route still does a hard delete but now cleans Drive files first.
-- This column is reserved for admin-initiated cancellations and the
-- deferred hard-delete job introduced with the Drive audit.

ALTER TABLE applications ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_apps_deleted_at ON applications(deleted_at)
  WHERE deleted_at IS NOT NULL;
