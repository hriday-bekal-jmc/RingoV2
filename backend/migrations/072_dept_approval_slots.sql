-- Department-level approval slot defaults.
-- Resolver: user_approval_slots takes priority; if NULL or absent, falls back to dept_approval_slots.
-- Admins can set dept defaults once instead of per-user. NULL approver_id = skip at dept level.

CREATE TABLE IF NOT EXISTS dept_approval_slots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  slot_id       UUID        NOT NULL REFERENCES approval_slots(id) ON DELETE CASCADE,
  approver_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(department_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_approval_slots_dept ON dept_approval_slots(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_approval_slots_approver ON dept_approval_slots(approver_id) WHERE approver_id IS NOT NULL;
