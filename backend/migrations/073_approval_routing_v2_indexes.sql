-- Missing lookup indexes for slot-centric admin queries.
-- Hot path (route-preview) is unaffected — already covered by 071/072 indexes.
-- These cover: slot usage counts, slot deletion cascade audit, approver lookups.

CREATE INDEX IF NOT EXISTS idx_pattern_slots_slot   ON approval_pattern_slots(slot_id);
CREATE INDEX IF NOT EXISTS idx_user_slots_slot       ON user_approval_slots(slot_id);
CREATE INDEX IF NOT EXISTS idx_conditions_stop_slot  ON approval_conditions(stop_at_slot_id);
