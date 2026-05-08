-- Migration 015: Performance indexes for hot query paths
--
-- These cover the queries we know are run constantly:
--   1. Approver inbox: WHERE approver_id = $1 AND status = 'PENDING'
--   2. History page:   WHERE applicant_id = $1 AND status = $2 ORDER BY created_at DESC
--   3. Accounting:     WHERE settlements.status = 'PENDING_VERIFICATION' ORDER BY created_at DESC
--   4. SSE filter:     WHERE applications.status IN (...) (used for dashboard counts)
--
-- All use IF NOT EXISTS so re-run is idempotent.
-- All are partial indexes where possible — smaller/faster than full table indexes.

-- ── Approval inbox (Approvals page) ──────────────────────────────────────────
-- /approvals/pending filters by approver_id + status='PENDING'.
-- Existing idx_steps_approver(approver_id, status) covers it but is full.
-- A partial index on PENDING-only is smaller and lookup-faster.
CREATE INDEX IF NOT EXISTS idx_steps_pending_inbox
  ON approval_steps(approver_id, application_id)
  WHERE status = 'PENDING';

-- ── History page ─────────────────────────────────────────────────────────────
-- /applications GET filters by applicant_id + status, orders by created_at DESC.
-- Composite covers the WHERE+ORDER without a sort.
CREATE INDEX IF NOT EXISTS idx_apps_applicant_status_created
  ON applications(applicant_id, status, created_at DESC);

-- ── Accounting dashboard ─────────────────────────────────────────────────────
-- Lists settlements ordered by created_at DESC, often filtered by status.
CREATE INDEX IF NOT EXISTS idx_settlements_status_created
  ON settlements(status, created_at DESC);

-- ── Application status fanout ────────────────────────────────────────────────
-- Dashboard does multiple COUNT(*) by status. A simple index helps a lot.
CREATE INDEX IF NOT EXISTS idx_apps_status
  ON applications(status);

-- ── Approval timeline lookup ─────────────────────────────────────────────────
-- /applications/:id loads timeline ordered by stage, step_order.
-- Existing idx_steps_app(application_id, stage, step_order) already covers this.

-- ── Audit log query convenience ──────────────────────────────────────────────
-- Audit logs grow forever; admins occasionally search by entity_id or action.
-- Lightweight indexes — write cost minimal vs lookup gain.
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_logs(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON audit_logs(action, created_at DESC);
