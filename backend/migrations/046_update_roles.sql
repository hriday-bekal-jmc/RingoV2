-- 046: Replace legacy roles with new hierarchy
-- Old: EMPLOYEE, MANAGER, GM, SOUMU, SENMU, PRESIDENT
-- New: SHITSUCHO, GM, SENIOR_MANAGER, MANAGER, SUB_MANAGER, SUB_MANAGER_TSUKI,
--       LEADER, SUB_LEADER, CHIEF, MEMBER, SENMU, PRESIDENT

-- ── 1. Migrate existing users ─────────────────────────────────────────────────
UPDATE users SET role = 'MEMBER'        WHERE role = 'EMPLOYEE';
UPDATE users SET role = 'MEMBER'        WHERE role = 'SOUMU';
-- MANAGER, GM, SENMU, PRESIDENT stay as-is

-- ── 2. allowance_rates — remove old, seed new ─────────────────────────────────
DELETE FROM allowance_rates WHERE role IN ('EMPLOYEE', 'SOUMU');

INSERT INTO allowance_rates (role, daily_rate_yen) VALUES
  ('SHITSUCHO',        2800),
  ('GM',               2600),
  ('SENIOR_MANAGER',   2400),
  ('MANAGER',          2200),
  ('SUB_MANAGER',      2000),
  ('SUB_MANAGER_TSUKI',2000),
  ('LEADER',           2000),
  ('SUB_LEADER',       2000),
  ('CHIEF',            2000),
  ('MEMBER',           2000),
  ('SENMU',            3000),
  ('PRESIDENT',        3000)
ON CONFLICT (role) DO UPDATE SET daily_rate_yen = EXCLUDED.daily_rate_yen;

-- ── 3. role_permissions — remove old, seed new ───────────────────────────────
DELETE FROM role_permissions WHERE role IN ('EMPLOYEE', 'SOUMU', 'ACCOUNTING');

INSERT INTO role_permissions (role, can_submit, can_approve, can_settle, can_admin, nav_pages) VALUES
  ('SHITSUCHO',        TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('GM',               TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('SENIOR_MANAGER',   TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('MANAGER',          TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('SUB_MANAGER',      TRUE,  TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history', '/history']),
  ('SUB_MANAGER_TSUKI',TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('LEADER',           TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('SUB_LEADER',       TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('CHIEF',            TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('MEMBER',           TRUE,  FALSE, FALSE, FALSE, ARRAY['/dashboard', '/history']),
  ('SENMU',            FALSE, TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history']),
  ('PRESIDENT',        FALSE, TRUE,  FALSE, FALSE, ARRAY['/dashboard', '/approvals', '/approval-history'])
ON CONFLICT (role) DO UPDATE
  SET can_submit  = EXCLUDED.can_submit,
      can_approve = EXCLUDED.can_approve,
      can_settle  = EXCLUDED.can_settle,
      can_admin   = EXCLUDED.can_admin,
      nav_pages   = EXCLUDED.nav_pages;

-- ── 4. Sync cached allowance rate for migrated users ─────────────────────────
UPDATE users u
SET daily_allowance_rate = ar.daily_rate_yen
FROM allowance_rates ar
WHERE ar.role = u.role;
