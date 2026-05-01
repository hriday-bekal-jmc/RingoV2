-- ==========================================
-- 006: 立替精算申請 — Expense Claim Template
-- Two-stage flow: RINGI → APPROVED → SETTLEMENT → COMPLETED
-- ==========================================

-- Add settlement columns to applications (track settlement phase data inline)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS settlement_data JSONB;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS settlement_submitted_at TIMESTAMPTZ;

-- Add EXPENSE_CLAIM template (Pattern 3: RINGI + SETTLEMENT)
-- Pattern 3 must already exist from migration 002
INSERT INTO form_templates (pattern_id, code, title, title_ja, schema_definition, settlement_schema)
VALUES (
    3,
    'EXPENSE_CLAIM',
    'Expense Claim & Reimbursement',
    '立替精算申請',
    '{
        "fields": [
            {"name": "purpose",           "label": "申請目的・件名",     "type": "textarea", "required": true},
            {"name": "expense_date",       "label": "発生日",             "type": "date",     "required": true},
            {"name": "expected_amount",    "label": "概算金額（円）",     "type": "number",   "required": true},
            {"name": "expense_category",   "label": "費目",               "type": "select",   "required": true,
             "options": ["交通費", "宿泊費", "飲食費（接待）", "消耗品費", "通信費", "その他"]},
            {"name": "notes",              "label": "備考",               "type": "textarea", "required": false}
        ]
    }'::jsonb,
    '{
        "fields": [
            {"name": "actual_amount",  "label": "実費合計（円）",     "type": "number",   "required": true},
            {"name": "expense_items",  "label": "費目明細",           "type": "textarea", "required": true},
            {"name": "receipts",       "label": "領収書・証憑",       "type": "file",     "required": true, "multiple": true},
            {"name": "notes",          "label": "精算備考",           "type": "textarea", "required": false}
        ]
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;
