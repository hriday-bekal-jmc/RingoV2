-- Migration 041: Recreation form — now a no-op.
-- All fixes from this file were merged back into 040_recreation_form.sql.
-- This file is kept for migration sequence integrity (already ran on some envs).
-- Safe to re-run — only touches RECREATION template, idempotent UPDATE.

UPDATE form_templates
SET
  pattern_id        = 3,
  schema_definition = '{
    "fields": [
      {
        "name":        "title",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）2025年度 部署レクリエーション",
        "show_in_row": true
      },
      {
        "name":     "purpose",
        "label":    "目的",
        "label_en": "Purpose",
        "type":     "textarea",
        "required": true
      },
      {
        "name":     "event_date",
        "label":    "開催日",
        "label_en": "Event Date",
        "type":     "date",
        "required": true
      },
      {
        "name":     "venue",
        "label":    "開催場所",
        "label_en": "Venue",
        "type":     "text",
        "required": true
      },
      {
        "name":     "venue_address",
        "label":    "開催場所住所",
        "label_en": "Venue Address",
        "type":     "text",
        "required": false
      },
      {
        "name":        "planned_participants",
        "label":       "参加予定者",
        "label_en":    "Planned Participants",
        "type":        "user_picker",
        "required":    true,
        "count_field": "participant_count"
      },
      {
        "name":        "participant_count",
        "label":       "参加人数",
        "label_en":    "Participant Count",
        "type":        "number",
        "computed":    true,
        "unit":        "人",
        "show_in_row": true
      },
      {
        "name":         "subsidy_amount",
        "label":        "補助申請額（上限）",
        "label_en":     "Max Subsidy",
        "type":         "number",
        "computed":     true,
        "formula":      "participant_count * 2000",
        "unit":         "円",
        "show_in_row":  true,
        "amount_field": true
      }
    ]
  }'::jsonb,
  settlement_schema = '{
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
        "label":    "参加人数",
        "label_en": "Participant Count",
        "type":     "number",
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
            "unit":       "円",
            "validation": { "min": 0 }
          }
        ]
      },
      {
        "name":       "receipt_total",
        "label":      "領収書合計",
        "label_en":   "Receipt Total",
        "type":       "number",
        "computed":   true,
        "sum_target": "receipts",
        "sum_field":  "receipt_amount",
        "unit":       "円"
      },
      {
        "name":         "final_subsidy",
        "label":        "補助申請額",
        "label_en":     "Final Subsidy",
        "type":         "number",
        "computed":     true,
        "formula":      "Math.min(actual_count * 2000, receipt_total)",
        "unit":         "円",
        "show_in_row":  true,
        "amount_field": true
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

-- Sync active version
UPDATE form_template_versions ftv
SET
  schema_definition = ft.schema_definition,
  settlement_schema = ft.settlement_schema
FROM form_templates ft
WHERE ftv.template_id = ft.id
  AND ft.code         = 'RECREATION'
  AND ftv.is_active   = TRUE;
