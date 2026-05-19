-- Seed missing workflow_patterns rows for pattern_id 1 and 2.
-- Migration 002 only seeded pattern 3 (BUSINESS_TRIP). Admin form-builder allows
-- creating templates with pattern_id 1 (ringi-only) or 2 (settlement-only) but
-- those rows were never inserted → FK violation on form_templates insert.
--
-- Idempotent — ON CONFLICT (code) DO NOTHING so re-run is safe.

INSERT INTO workflow_patterns (id, code, name, description) VALUES
  (1, 'PATTERN_1', '稟議のみ (Ringi only)',          'Approval-only workflow with no settlement phase.'),
  (2, 'PATTERN_2', '精算のみ (Settlement only)',      'Settlement-only workflow with no preceding ringi approval.')
ON CONFLICT (code) DO NOTHING;

-- Bump SERIAL sequence past any explicit IDs so future inserts don't collide.
-- GREATEST handles the case where the sequence is already ahead.
SELECT setval(
  pg_get_serial_sequence('workflow_patterns', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 0) FROM workflow_patterns), 3)
);
