-- Migration 026: admin as user privilege flag
--
-- Admin is no longer a business role. Users keep their normal approval role
-- (MANAGER, SOUMU, etc.) and can additionally have is_admin=true.
-- Legacy role='ADMIN' rows are copied into the new flag for compatibility.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_admin = TRUE
WHERE role = 'ADMIN'
  AND is_admin = FALSE;

-- Clean non-production legacy data: ADMIN is no longer valid as a business
-- role. Keep admin privilege in is_admin, then assign a normal role.
UPDATE users u
SET role = CASE
  WHEN d.code = 'SOUMU' THEN 'SOUMU'
  WHEN d.code = 'KEIRI' THEN 'ACCOUNTING'
  ELSE 'EMPLOYEE'
END
FROM departments d
WHERE u.department_id = d.id
  AND u.role = 'ADMIN';

UPDATE users
SET role = 'EMPLOYEE'
WHERE role = 'ADMIN';

CREATE INDEX IF NOT EXISTS idx_users_is_admin_true
  ON users(id)
  WHERE is_admin = TRUE;
