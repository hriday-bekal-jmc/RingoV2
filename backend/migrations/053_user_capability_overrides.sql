-- Migration 053: per-user capability overrides
--
-- Allows granting specific capabilities to individual users beyond their role.
-- Use case: a MEMBER in the accounting team needs /accounting access without
-- changing their org role.
--
-- Overrides are ADDITIVE only — they can grant but never revoke role permissions.
-- Capabilities mirror the role_permissions column names for consistency.

CREATE TABLE IF NOT EXISTS user_capability_overrides (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability VARCHAR(32) NOT NULL
    CHECK (capability IN ('can_approve', 'can_settle', 'can_admin')),
  granted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_user_cap_overrides_user ON user_capability_overrides(user_id);
