-- 011_deduplicate_settlement_steps.sql
-- Remove duplicate approval_steps rows (same application_id + stage + step_order).
-- Caused by migration 009 + start-settlement both inserting steps without DELETE first.
-- Keep one row per (application_id, stage, step_order): prefer PENDING > WAITING > APPROVED.

DELETE FROM approval_steps
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY application_id, stage, step_order
             ORDER BY
               CASE status
                 WHEN 'PENDING'  THEN 1
                 WHEN 'WAITING'  THEN 2
                 WHEN 'APPROVED' THEN 3
                 ELSE 4
               END,
               created_at DESC
           ) AS rn
    FROM approval_steps
  ) ranked
  WHERE rn > 1
);
