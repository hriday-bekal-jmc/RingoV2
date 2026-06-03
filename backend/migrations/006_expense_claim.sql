-- ==========================================
-- 006: 立替精算申請 — Expense Claim Template
-- Two-stage flow: RINGI → APPROVED → SETTLEMENT → COMPLETED
-- ==========================================

-- Add settlement columns to applications (track settlement phase data inline)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS settlement_data JSONB;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS settlement_submitted_at TIMESTAMPTZ;

-- Add EXPENSE_CLAIM template (Pattern 3: RINGI + SETTLEMENT)
-- Pattern 3 must already exist from migration 002
-- ON CONFLICT DO UPDATE: safe to re-run — updates schema without touching other columns
INSERT INTO form_templates (pattern_id, code, title, title_ja, schema_definition, settlement_schema)
VALUES (
    3,
    'EXPENSE_CLAIM',
    'Expense Claim & Reimbursement',
    '立替精算申請',
    '{
        "fields": [
            {"name": "subject",
             "label": "件名", "label_en": "Subject",
             "type": "text", "required": true},
            {"name": "purpose",
             "label": "用途・目的", "label_en": "Purpose",
             "type": "textarea", "required": true},
            {"name": "expense_date",
             "label": "立替予定日", "label_en": "Expense Date",
             "type": "date", "required": true},
            {"name": "expense_category",
             "label": "勘定科目", "label_en": "Account Category",
             "type": "select", "required": true,
             "options": [
                 "交通費",
                 "宿泊費",
                 "飲食費（接待）",
                 "消耗品費",
                 "通信費",
                 "発送・通信費",
                 "備品・消耗品購入費",
                 "租税公課",
                 "経費",
                 "その他"
             ]},
            {"name": "notes",
             "label": "備考", "label_en": "Notes",
             "type": "textarea", "required": false},
            {"name": "expense_items",
             "label": "見込内訳", "label_en": "Estimated Breakdown",
             "type": "repeat_group",
             "required": true, "min_rows": 1,
             "add_label": "明細を追加", "add_label_en": "Add item",
             "fields": [
                 {"name": "purchase_date",
                  "label": "購入日", "label_en": "Date",
                  "type": "date", "required": true},
                 {"name": "vendor",
                  "label": "購入先", "label_en": "Vendor",
                  "type": "text", "required": true},
                 {"name": "item_description",
                  "label": "内容", "label_en": "Description",
                  "type": "text", "required": true},
                 {"name": "amount",
                  "label": "金額（円）", "label_en": "Amount",
                  "type": "number", "required": true,
                  "validation": {"min": 0},
                  "sum_target": "expected_amount"}
             ]},
            {"name": "expected_amount",
             "label": "見込金額（円）", "label_en": "Estimated Total",
             "type": "number", "computed": true,
             "unit": "円", "show_in_row": true, "amount_field": true}
        ]
    }'::jsonb,
    '{
        "fields": [
            {"name": "actual_items",
             "label": "実費明細", "label_en": "Actual Expense Breakdown",
             "type": "repeat_group", "required": true, "min_rows": 1,
             "add_label": "明細を追加", "add_label_en": "Add item",
             "fields": [
                 {"name": "purchase_date",    "label": "購入日",     "label_en": "Date",        "type": "date",   "required": true},
                 {"name": "vendor",           "label": "購入先",     "label_en": "Vendor",       "type": "text",   "required": true},
                 {"name": "item_description", "label": "内容",       "label_en": "Description",  "type": "text",   "required": true},
                 {"name": "amount",           "label": "金額（円）", "label_en": "Amount",       "type": "number", "required": true,
                  "validation": {"min": 0}, "sum_target": "actual_amount"}
             ]},
            {"name": "actual_amount",
             "label": "実費合計（円）", "label_en": "Actual Total",
             "type": "number", "computed": true,
             "unit": "円", "show_in_row": true, "amount_field": true},
            {"name": "receipts",
             "label": "領収書・証憑", "label_en": "Receipts",
             "type": "file", "required": true, "multiple": true},
            {"name": "notes",
             "label": "精算備考", "label_en": "Settlement Notes",
             "type": "textarea", "required": false}
        ]
    }'::jsonb
) ON CONFLICT (code) DO UPDATE
  SET schema_definition  = EXCLUDED.schema_definition,
      settlement_schema  = EXCLUDED.settlement_schema,
      title              = EXCLUDED.title,
      title_ja           = EXCLUDED.title_ja;

-- Patch active template version so new applications pick up the updated schema
-- (form_template_versions is what the app reads at submit time)
UPDATE form_template_versions ftv
SET schema_definition  = ft.schema_definition,
    settlement_schema  = ft.settlement_schema
FROM form_templates ft
WHERE ft.code         = 'EXPENSE_CLAIM'
  AND ftv.template_id = ft.id
  AND ftv.is_active   = TRUE;
