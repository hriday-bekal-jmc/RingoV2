-- Migration 056: partial index optimising /approvals/history read path
--
-- The history query filters:
--   WHERE s.status IN ('APPROVED', 'REJECTED', 'RETURNED') AND s.acted_by = $1
--   ORDER BY s.acted_at DESC, s.id DESC
--
-- Existing idx_steps_acted_by_status_acted_id carries `status` as a column,
-- forcing a lookup across three status values. This partial index encodes
-- the status predicate, removing it from the scan columns → smaller index,
-- fewer pages read per history query.
--
-- The old index still covers queries that need status as a bind param (e.g.
-- admin search by specific action); both can coexist.

CREATE INDEX IF NOT EXISTS idx_steps_acted_history
  ON approval_steps(acted_by, acted_at DESC, id DESC)
  WHERE status IN ('APPROVED', 'REJECTED', 'RETURNED');
