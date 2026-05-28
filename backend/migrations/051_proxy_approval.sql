-- Migration 051: Proxy approval support
-- Adds proxy_approved_by to record who acted on behalf of the assigned approver.

ALTER TABLE approval_steps
  ADD COLUMN IF NOT EXISTS proxy_approved_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_steps_proxy
  ON approval_steps (proxy_approved_by)
  WHERE proxy_approved_by IS NOT NULL;
