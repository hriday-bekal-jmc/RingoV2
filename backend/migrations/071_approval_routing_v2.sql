-- Migration 071: Approval Routing V2 — User × Pattern cross-reference
--
-- Replaces approval_routes / approval_route_steps with a per-user slot model:
--   1. approval_slots          — 18 semantic named positions (ringi_1-6, settle_1-6+mgr, confirm_1-3)
--   2. user_approval_slots     — per-user approver per slot (NULL = not applicable for that user)
--   3. approval_patterns       — 9 workflow pattern definitions
--   4. approval_pattern_slots  — which slots are ● active per pattern
--   5. form_template_patterns  — template → pattern assignments
--   6. approval_conditions     — conditional stop rules (amount / dept / per-user override)
--
-- Old tables (approval_routes, approval_route_steps) are dropped in migration 073
-- after all templates have been migrated to the new system.

-- ── trigger helper (idempotent) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- NEW TABLES
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Canonical slot catalog (18 rows, admin-immutable) ──────────────────
CREATE TABLE IF NOT EXISTS approval_slots (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_code  VARCHAR(30)  NOT NULL UNIQUE,
  label_ja   VARCHAR(60)  NOT NULL,
  slot_type  VARCHAR(20)  NOT NULL CHECK (slot_type IN ('RINGI','SETTLEMENT','CONFIRM')),
  sort_order INT          NOT NULL
);

-- ── 2. Per-user approver assignments ─────────────────────────────────────
-- NULL approver_id = slot not applicable for this user (silently skipped in chain).
CREATE TABLE IF NOT EXISTS user_approval_slots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  slot_id      UUID        NOT NULL REFERENCES approval_slots(id) ON DELETE CASCADE,
  approver_id  UUID                    REFERENCES users(id)       ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_by   UUID                    REFERENCES users(id)       ON DELETE SET NULL,
  UNIQUE (user_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_user_slots_user     ON user_approval_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_user_slots_approver ON user_approval_slots(approver_id);

CREATE OR REPLACE TRIGGER trg_user_slots_updated
  BEFORE UPDATE ON user_approval_slots
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 3. Pattern definitions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_patterns (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. Active slots per pattern ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_pattern_slots (
  pattern_id UUID NOT NULL REFERENCES approval_patterns(id) ON DELETE CASCADE,
  slot_id    UUID NOT NULL REFERENCES approval_slots(id)    ON DELETE CASCADE,
  PRIMARY KEY (pattern_id, slot_id)
);

-- ── 5. Template → pattern assignments ────────────────────────────────────
-- One template can have multiple patterns (primary + optional secondary).
-- User picks at submit time; is_default = TRUE row is pre-selected.
CREATE TABLE IF NOT EXISTS form_template_patterns (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID    NOT NULL REFERENCES form_templates(id)    ON DELETE CASCADE,
  pattern_id  UUID    NOT NULL REFERENCES approval_patterns(id) ON DELETE CASCADE,
  is_default  BOOLEAN DEFAULT TRUE,
  priority    INT     NOT NULL DEFAULT 0,
  UNIQUE (template_id, pattern_id)
);
CREATE INDEX IF NOT EXISTS idx_ftp_template ON form_template_patterns(template_id);

-- ── 6. Conditional stop rules ─────────────────────────────────────────────
-- Evaluated at submit time. user_id NULL = applies to all; set UUID for per-user override.
-- Most-specific match wins (user-specific overrides global when both conditions match).
CREATE TABLE IF NOT EXISTS approval_conditions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID        NOT NULL REFERENCES form_templates(id)    ON DELETE CASCADE,
  pattern_id      UUID        NOT NULL REFERENCES approval_patterns(id) ON DELETE CASCADE,
  user_id         UUID                    REFERENCES users(id)          ON DELETE CASCADE,
  condition_type  VARCHAR(30) NOT NULL CHECK (condition_type IN ('AMOUNT_LT','AMOUNT_GTE','DEPT_IN','DEPT_NOT_IN')),
  condition_value TEXT        NOT NULL,
  stop_at_slot_id UUID        NOT NULL REFERENCES approval_slots(id)    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cond_template ON approval_conditions(template_id, pattern_id);

-- ── 7. Add pattern reference to applications ──────────────────────────────
-- NULL = old system (route_id used). Set for new-system submissions.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS approval_pattern_id UUID REFERENCES approval_patterns(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED DATA — 18 slots
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO approval_slots (slot_code, label_ja, slot_type, sort_order) VALUES
  ('ringi_1',   '承認1',           'RINGI',      1),
  ('ringi_2',   '承認2',           'RINGI',      2),
  ('ringi_2_5', '承認2.5（美容）',  'RINGI',      3),
  ('ringi_3',   '承認3',           'RINGI',      4),
  ('ringi_4',   '承認4',           'RINGI',      5),
  ('ringi_5',   '承認5',           'RINGI',      6),
  ('ringi_6',   '承認6',           'RINGI',      7),
  ('settle_1',  '精算1',           'SETTLEMENT', 8),
  ('settle_2',  '精算2',           'SETTLEMENT', 9),
  ('settle_3',  '精算3',           'SETTLEMENT', 10),
  ('settle_4',  '精算4',           'SETTLEMENT', 11),
  ('settle_5',  '精算5',           'SETTLEMENT', 12),
  ('settle_6',  '精算6',           'SETTLEMENT', 13),
  ('settle_mgr','精算管理',         'SETTLEMENT', 14),
  ('confirm_1', '確認必須1',        'CONFIRM',    15),
  ('confirm_2', '確認必須2',        'CONFIRM',    16),
  ('confirm_3', '確認必須3',        'CONFIRM',    17)
ON CONFLICT (slot_code) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED DATA — 9 approval patterns
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO approval_patterns (name, description) VALUES
  ('稟議→精算（購入）',        '購入を伴う稟議・精算フロー'),
  ('稟議→精算（購入以外）',    '購入以外の稟議・精算フロー'),
  ('精算のみ',                 '精算のみのフロー'),
  ('稟議のみ（総務）',          '総務承認の稟議フロー'),
  ('稟議のみ（祝い金）',        '祝い金の稟議フロー'),
  ('稟議のみ（総務要承認）',    '総務承認が必要な稟議フロー'),
  ('稟議のみ（総務承認不要）',  '総務承認不要な稟議フロー'),
  ('稟議のみ（PC持ち出し）',   'PC持ち出し稟議フロー'),
  ('稟議のみ（小口払い）',      '小口払い稟議フロー')
ON CONFLICT (name) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED DATA — active slots per pattern
-- ══════════════════════════════════════════════════════════════════════════

-- Pattern 1: 稟議→精算（購入）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議→精算（購入）'
  AND s.slot_code IN ('ringi_1','ringi_2','ringi_2_5','ringi_4','ringi_5','ringi_6',
                      'settle_2','settle_3','settle_4','settle_5','settle_6','settle_mgr')
ON CONFLICT DO NOTHING;

-- Pattern 2: 稟議→精算（購入以外）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議→精算（購入以外）'
  AND s.slot_code IN ('ringi_1','ringi_2','ringi_2_5','ringi_5','ringi_6',
                      'settle_1','settle_2','settle_3','settle_4','settle_5','settle_6','settle_mgr')
ON CONFLICT DO NOTHING;

-- Pattern 3: 精算のみ
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '精算のみ'
  AND s.slot_code IN ('settle_1','settle_2','settle_3','settle_4','settle_5','settle_6','settle_mgr')
ON CONFLICT DO NOTHING;

-- Pattern 4: 稟議のみ（総務）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（総務）'
  AND s.slot_code IN ('ringi_3','ringi_4')
ON CONFLICT DO NOTHING;

-- Pattern 5: 稟議のみ（祝い金）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（祝い金）'
  AND s.slot_code IN ('ringi_2','ringi_2_5','ringi_5','ringi_6','confirm_1','confirm_2')
ON CONFLICT DO NOTHING;

-- Pattern 6: 稟議のみ（総務要承認）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（総務要承認）'
  AND s.slot_code IN ('ringi_1','ringi_2','ringi_3','ringi_4','ringi_5','ringi_6')
ON CONFLICT DO NOTHING;

-- Pattern 7: 稟議のみ（総務承認不要）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（総務承認不要）'
  AND s.slot_code IN ('ringi_1','ringi_2','ringi_3','ringi_5','ringi_6','confirm_1')
ON CONFLICT DO NOTHING;

-- Pattern 8: 稟議のみ（PC持ち出し）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（PC持ち出し）'
  AND s.slot_code IN ('ringi_2','ringi_4')
ON CONFLICT DO NOTHING;

-- Pattern 9: 稟議のみ（小口払い）
INSERT INTO approval_pattern_slots (pattern_id, slot_id)
SELECT p.id, s.id FROM approval_patterns p, approval_slots s
WHERE p.name = '稟議のみ（小口払い）'
  AND s.slot_code IN ('ringi_1','ringi_2','ringi_3','ringi_4','ringi_5','ringi_6','confirm_1','confirm_2')
ON CONFLICT DO NOTHING;
