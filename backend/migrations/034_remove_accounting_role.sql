-- Remove legacy ACCOUNTING role. SOUMU now handles accounting/settlement duties.
-- Any existing users with role='ACCOUNTING' are converted to SOUMU (same capability set).
-- Permission row for ACCOUNTING removed from role_permissions.
-- Idempotent — safe to re-run.

UPDATE users SET role = 'SOUMU' WHERE role = 'ACCOUNTING';

DELETE FROM role_permissions WHERE role = 'ACCOUNTING';
