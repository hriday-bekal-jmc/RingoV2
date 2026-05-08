-- Migration 014: lock down status enums with CHECK constraints
--
-- Schema currently uses VARCHAR for status columns with no enforcement,
-- so any typo at INSERT silently corrupts data. Adds CHECK constraints
-- pinned to the actual valid values used by the app code.
--
-- IMPORTANT: This migration does NOT change any data. WAITING is intentional
-- (queued/not-yet-active step, distinct from PENDING which means current).
-- An earlier audit incorrectly flagged it as a bug — it isn't.
--
-- Valid status values (verified against backend/src/routes):
--
--   applications.status:
--     DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, RETURNED, CANCELLED,
--     PENDING_SETTLEMENT, SETTLEMENT_APPROVED, COMPLETED
--
--   approval_steps.status:
--     PENDING   — current active step
--     WAITING   — queued, will become PENDING when previous step approves
--     APPROVED  — acted on, approved
--     REJECTED  — acted on, rejected
--     RETURNED  — applicant must fix and resubmit
--     SKIPPED   — route changed, this branch was never active
--     CANCELLED — dead-branch cleanup after RETURN/REJECT
--
--   settlements.status:
--     PENDING_VERIFICATION — default on insert
--     PROCESSED            — set when accounting closes the settlement

-- ── 1. Pre-validate existing rows ─────────────────────────────────────────────
-- If any existing rows have invalid statuses, fail loudly BEFORE adding the
-- constraint. This way we know about data drift instead of silently breaking
-- inserts.

DO $$
DECLARE
  bad_count INT;
  bad_list  TEXT;
BEGIN
  -- applications
  SELECT COUNT(*), STRING_AGG(DISTINCT status, ', ') INTO bad_count, bad_list
  FROM applications
  WHERE status NOT IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED',
    'CANCELLED', 'PENDING_SETTLEMENT', 'SETTLEMENT_APPROVED', 'COMPLETED'
  );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'applications has % rows with invalid status (values: %)', bad_count, bad_list;
  END IF;

  -- approval_steps
  SELECT COUNT(*), STRING_AGG(DISTINCT status, ', ') INTO bad_count, bad_list
  FROM approval_steps
  WHERE status NOT IN (
    'PENDING', 'WAITING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED'
  );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'approval_steps has % rows with invalid status (values: %)', bad_count, bad_list;
  END IF;

  -- settlements
  SELECT COUNT(*), STRING_AGG(DISTINCT status, ', ') INTO bad_count, bad_list
  FROM settlements
  WHERE status NOT IN (
    'PENDING_VERIFICATION', 'PROCESSED'
  );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'settlements has % rows with invalid status (values: %)', bad_count, bad_list;
  END IF;
END $$;

-- ── 2. Add CHECK constraints ─────────────────────────────────────────────────

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED',
    'CANCELLED', 'PENDING_SETTLEMENT', 'SETTLEMENT_APPROVED', 'COMPLETED'
  ));

ALTER TABLE approval_steps
  DROP CONSTRAINT IF EXISTS approval_steps_status_check;
ALTER TABLE approval_steps
  ADD CONSTRAINT approval_steps_status_check
  CHECK (status IN (
    'PENDING', 'WAITING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED'
  ));

ALTER TABLE settlements
  DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements
  ADD CONSTRAINT settlements_status_check
  CHECK (status IN (
    'PENDING_VERIFICATION', 'PROCESSED'
  ));
