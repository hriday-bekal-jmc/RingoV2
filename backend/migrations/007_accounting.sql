-- ==========================================
-- 007: Accounting enhancements
-- • Add transfer_proof_url + accounting_note to settlements
-- • Update EXPENSE_CLAIM settlement_schema to use line_items for auto-calculation
-- ==========================================

-- Add accounting columns to settlements
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS transfer_proof_url VARCHAR(500);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS accounting_note TEXT;

-- Update EXPENSE_CLAIM settlement_schema: replace textarea expense_items with
-- structured line_items (auto-computes into actual_amount)
UPDATE form_templates
SET settlement_schema = '{
    "fields": [
        {
            "name": "expense_items_table",
            "label": "費目明細（実費）",
            "type": "line_items",
            "required": true,
            "computes": "actual_amount"
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
