-- ==========================================
-- 008: Settlement schema v2
-- Replace line_items with named category fields (transport / hotel / food / other)
-- Each has sum_target:"actual_amount" so the frontend auto-sums them.
-- ==========================================

UPDATE form_templates
SET settlement_schema = '{
    "fields": [
        {
            "name": "transport_amount",
            "label": "交通費（円）",
            "type": "number",
            "required": false,
            "sum_target": "actual_amount"
        },
        {
            "name": "accommodation_amount",
            "label": "宿泊費（円）",
            "type": "number",
            "required": false,
            "sum_target": "actual_amount"
        },
        {
            "name": "food_amount",
            "label": "飲食費・接待費（円）",
            "type": "number",
            "required": false,
            "sum_target": "actual_amount"
        },
        {
            "name": "other_amount",
            "label": "その他（円）",
            "type": "number",
            "required": false,
            "sum_target": "actual_amount"
        },
        {
            "name": "actual_amount",
            "label": "実費合計（円）",
            "type": "number",
            "required": true,
            "computed": true
        },
        {
            "name": "receipts",
            "label": "領収書・証憑",
            "type": "file",
            "required": true,
            "multiple": true
        },
        {
            "name": "notes",
            "label": "精算備考",
            "type": "textarea",
            "required": false
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
