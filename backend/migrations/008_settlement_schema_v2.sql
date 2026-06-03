-- ==========================================
-- 008: Settlement schema v3 (updated to match new ringi repeat_group structure)
-- actual_items repeat_group mirrors ringi expense_items → auto-sums to actual_amount
-- ==========================================

UPDATE form_templates
SET settlement_schema = '{
    "fields": [
        {
            "name": "actual_items",
            "label": "実費明細", "label_en": "Actual Expense Breakdown",
            "type": "repeat_group",
            "required": true, "min_rows": 1,
            "add_label": "明細を追加", "add_label_en": "Add item",
            "fields": [
                {"name": "purchase_date",    "label": "購入日",     "label_en": "Date",        "type": "date",   "required": true},
                {"name": "vendor",           "label": "購入先",     "label_en": "Vendor",       "type": "text",   "required": true},
                {"name": "item_description", "label": "内容",       "label_en": "Description",  "type": "text",   "required": true},
                {"name": "amount",           "label": "金額（円）", "label_en": "Amount",       "type": "number", "required": true,
                 "validation": {"min": 0}, "sum_target": "actual_amount"}
            ]
        },
        {
            "name": "actual_amount",
            "label": "実費合計（円）", "label_en": "Actual Total",
            "type": "number", "computed": true,
            "unit": "円", "show_in_row": true, "amount_field": true
        },
        {
            "name": "receipts",
            "label": "領収書・証憑", "label_en": "Receipts",
            "type": "file", "required": true, "multiple": true
        },
        {
            "name": "notes",
            "label": "精算備考", "label_en": "Settlement Notes",
            "type": "textarea", "required": false
        }
    ]
}'::jsonb
WHERE code = 'EXPENSE_CLAIM';

-- Sync active version so form builder matches
UPDATE form_template_versions ftv
SET schema_definition = ft.schema_definition,
    settlement_schema = ft.settlement_schema
FROM form_templates ft
WHERE ft.code = 'EXPENSE_CLAIM' AND ftv.template_id = ft.id AND ftv.is_active = TRUE;
