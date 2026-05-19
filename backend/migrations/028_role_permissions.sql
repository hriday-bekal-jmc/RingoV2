CREATE TABLE IF NOT EXISTS role_permissions (
  role           VARCHAR(32) PRIMARY KEY,
  can_submit     BOOLEAN NOT NULL DEFAULT TRUE,
  can_approve    BOOLEAN NOT NULL DEFAULT FALSE,
  can_settle     BOOLEAN NOT NULL DEFAULT FALSE,
  can_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  nav_pages      TEXT[]  NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed from current permissions.ts values
INSERT INTO role_permissions (role, can_submit, can_approve, can_settle, can_admin, nav_pages) VALUES
  ('EMPLOYEE',   TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('MANAGER',    TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('GM',         TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('SOUMU',      TRUE,  TRUE,  TRUE,  FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/accounting', '/history']),
  ('SENMU',      FALSE, TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history']),
  ('PRESIDENT',  FALSE, TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history']),
  ('ACCOUNTING', FALSE, TRUE,  TRUE,  FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/accounting']),
  ('ADMIN',      TRUE,  TRUE,  TRUE,  TRUE,  ARRAY['/dashboard', '/approvals', '/approval-history', '/accounting', '/history', '/admin'])
ON CONFLICT (role) DO NOTHING;
