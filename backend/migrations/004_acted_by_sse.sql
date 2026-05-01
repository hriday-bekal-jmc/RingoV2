-- Track WHO actually performed each approval action (vs who was assigned)
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS acted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for fast lookup "did this user already act on any step for this app?"
CREATE INDEX IF NOT EXISTS idx_approval_steps_acted_by ON approval_steps(application_id, acted_by);
