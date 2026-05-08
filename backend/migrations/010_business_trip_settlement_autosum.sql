-- Migration 010: Add sum_target + computed to BUSINESS_TRIP settlement_schema
-- Moves actual_amount to end, adds sum_target on category fields so the
-- frontend auto-calculates the total. Also pre-fills expected_amount hint.

UPDATE form_templates
SET settlement_schema = '{
  "fields": [
    {
      "name": "transportation_fee",
      "label": "交通費（円）",
      "type": "number",
      "required": false,
      "sum_target": "actual_amount"
    },
    {
      "name": "accommodation_fee",
      "label": "宿泊費（円）",
      "type": "number",
      "required": false,
      "sum_target": "actual_amount"
    },
    {
      "name": "food_fee",
      "label": "食事代（円）",
      "type": "number",
      "required": false,
      "sum_target": "actual_amount"
    },
    {
      "name": "other_fee",
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
      "name": "receipt_files",
      "label": "領収書（PDF/画像）",
      "type": "file",
      "multiple": true,
      "required": true
    },
    {
      "name": "notes",
      "label": "備考",
      "type": "textarea",
      "required": false
    }
  ]
}'::jsonb
WHERE code = 'BUSINESS_TRIP';
