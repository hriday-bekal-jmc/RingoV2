-- Migration 041: Recreation form fixes
--
-- 1. Add unit:"人" to participant_count (ringi) and actual_count (settlement)
-- 2. Fix final_subsidy formula (|| failed whitelist)
-- 3. Replace transfer_date with recreation_date in settlement

-- ── Ringi schema: add unit to participant_count ───────────────────────────────
UPDATE form_templates
SET schema_definition = jsonb_set(
  schema_definition,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE WHEN f->>'name' = 'participant_count'
           THEN f || '{"unit":"人"}'::jsonb
           ELSE f
      END
    )
    FROM jsonb_array_elements(schema_definition->'fields') f
  )
)
WHERE code = 'RECREATION';

-- ── Settlement schema: full replacement with all fixes ────────────────────────
UPDATE form_templates
SET settlement_schema = '{
  "fields": [
    {
      "name":        "actual_participants",
      "label":       "参加者",
      "label_en":    "Participants",
      "type":        "user_picker",
      "required":    true,
      "count_field": "actual_count"
    },
    {
      "name":     "actual_count",
      "label":    "参加人数合計",
      "label_en": "Total Participants",
      "type":     "number",
      "required": true,
      "computed": true,
      "unit":     "人"
    },
    {
      "name":         "receipts",
      "label":        "領収書",
      "label_en":     "Receipts",
      "type":         "repeat_group",
      "required":     false,
      "min_rows":     0,
      "add_label":    "領収書を追加",
      "add_label_en": "Add Receipt",
      "fields": [
        {
          "name":                "receipt_file",
          "label":               "領収書ファイル",
          "label_en":            "Receipt File",
          "type":                "ai_file_reader",
          "required":            false,
          "file_category":       "receipts",
          "target_amount_field": "receipt_amount"
        },
        {
          "name":        "receipt_number",
          "label":       "領収書番号",
          "label_en":    "Receipt No.",
          "type":        "text",
          "required":    true,
          "placeholder": "例）001"
        },
        {
          "name":       "receipt_amount",
          "label":      "金額",
          "label_en":   "Amount",
          "type":       "number",
          "required":   true,
          "validation": { "min": 0 }
        }
      ]
    },
    {
      "name":       "receipt_total",
      "label":      "領収書合計",
      "label_en":   "Receipt Total",
      "type":       "number",
      "required":   false,
      "computed":   true,
      "sum_target": "receipts",
      "sum_field":  "receipt_amount"
    },
    {
      "name":       "final_subsidy",
      "label":      "補助申請額",
      "label_en":   "Final Subsidy Amount",
      "type":       "number",
      "required":   true,
      "computed":   true,
      "formula":    "Math.min(actual_count * 2000, receipt_total)",
      "show_in_row": true
    },
    {
      "name":     "recreation_date",
      "label":    "レクリエーション実施日",
      "label_en": "Recreation Date",
      "type":     "date",
      "required": true
    }
  ]
}'::jsonb
WHERE code = 'RECREATION';

-- ── Sync active version ───────────────────────────────────────────────────────
UPDATE form_template_versions ftv
SET
  schema_definition = ft.schema_definition,
  settlement_schema = ft.settlement_schema
FROM form_templates ft
WHERE ftv.template_id = ft.id
  AND ft.code         = 'RECREATION'
  AND ftv.is_active   = TRUE;
