-- Migration 069: ET伺い → 接待交際費精算表 (Entertainment Expense)
--
-- Pattern 3 (稟議→精算).
--   Ringi  (伺い)   : request approval with client, purpose, estimated amount
--   Settlement (精算): itemised expense entries, receipt attachment, auto-totalled
--
-- App prefix : ET
-- Icon       : 🥂
-- Gradient   : amber → orange

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  3,
  'ENTERTAINMENT',
  'Entertainment Expense',
  '接待交際費',
  -- ─────────────────────── RINGI SCHEMA (伺い) ───────────────────────
  '{
    "fields": [
      {
        "name":          "subject",
        "label":         "件名",
        "label_en":      "Subject",
        "type":          "text",
        "required":      true,
        "default_value": "接待交際費申請",
        "show_in_row":   true
      },
      {
        "name":  "request_group",
        "label": "申請内容",
        "type":  "field_group",
        "fields": [
          {
            "name":     "client_name",
            "label":    "得意先",
            "label_en": "Client / Guest",
            "type":     "text",
            "required": true,
            "col_span": "half",
            "placeholder": "例）株式会社〇〇"
          },
          {
            "name":        "purpose",
            "label":       "用務",
            "label_en":    "Business Purpose",
            "type":        "text",
            "required":    true,
            "col_span":    "half",
            "placeholder": "例）会食、接待、懇親会"
          },
          {
            "name":     "planned_date",
            "label":    "予定日",
            "label_en": "Planned Date",
            "type":     "date",
            "required": true,
            "col_span": "quarter"
          },
          {
            "name":       "estimated_amount",
            "label":      "概算金額",
            "label_en":   "Estimated Amount",
            "type":       "number",
            "required":   true,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          },
          {
            "name":       "attendee_count",
            "label":      "参加予定人数",
            "label_en":   "Estimated Attendees",
            "type":       "number",
            "required":   false,
            "col_span":   "quarter",
            "unit":       "名",
            "validation": { "min": 1 }
          }
        ]
      },
      {
        "name":        "details",
        "label":       "詳細・目的",
        "label_en":    "Details / Purpose",
        "type":        "textarea",
        "required":    false,
        "col_span":    "full",
        "placeholder": "接待の目的、相手の役職・関係性など"
      }
    ]
  }',
  -- ─────────────────────── SETTLEMENT SCHEMA (精算表) ───────────────────────
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "show_in_row": true
      },
      {
        "name":  "info_group",
        "label": "精算情報",
        "type":  "field_group",
        "fields": [
          {
            "name":      "client_name",
            "label":     "得意先",
            "label_en":  "Client / Guest",
            "type":      "text",
            "required":  true,
            "col_span":  "half",
            "copy_from": "client_name"
          },
          {
            "name":      "purpose",
            "label":     "用務",
            "label_en":  "Business Purpose",
            "type":      "text",
            "required":  true,
            "col_span":  "half",
            "copy_from": "purpose"
          }
        ]
      },
      {
        "name":              "expense_entries",
        "label":             "明細",
        "label_en":          "Expense Items",
        "type":              "repeat_group",
        "required":          false,
        "min_rows":          1,
        "add_label":         "明細を追加",
        "add_label_en":      "Add item",
        "target_amount_field": "amount",
        "fields": [
          {
            "name":     "expense_date",
            "label":    "日付",
            "label_en": "Date",
            "type":     "date",
            "required": true,
            "col_span": "quarter"
          },
          {
            "name":        "payee",
            "label":       "支払先",
            "label_en":    "Paid To",
            "type":        "text",
            "required":    true,
            "col_span":    "third",
            "placeholder": "例）わらやき屋 北新地店"
          },
          {
            "name":        "description",
            "label":       "内容",
            "label_en":    "Description",
            "type":        "text",
            "required":    true,
            "col_span":    "third",
            "placeholder": "例）会食費用"
          },
          {
            "name":       "amount",
            "label":      "金額",
            "label_en":   "Amount",
            "type":       "number",
            "required":   true,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          }
        ]
      },
      {
        "name":         "total_amount",
        "label":        "精算額合計",
        "label_en":     "Total",
        "type":         "number",
        "computed":     true,
        "sum_target":   "expense_entries",
        "sum_field":    "amount",
        "unit":         "円",
        "col_span":     "quarter",
        "show_in_row":  true,
        "amount_field": true
      },
      {
        "name":          "receipts",
        "label":         "領収書",
        "label_en":      "Receipts",
        "type":          "file",
        "required":      true,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "領収書を貼り付けた用紙または電子データを添付してください。足りない場合は裏面等を使用。"
      },
      {
        "name":     "notes",
        "label":    "備考",
        "label_en": "Notes",
        "type":     "textarea",
        "required": false,
        "col_span": "full"
      }
    ]
  }',
  TRUE,
  FALSE,
  '🥂',
  'from-amber-400 to-orange-500',
  '接待・交際費の事前申請と精算をまとめて管理するフォーム',
  'Entertainment expense — ringi approval followed by itemised settlement with receipts',
  'ET',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'ENTERTAINMENT'
);

-- Version record — required for form builder display
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'ENTERTAINMENT'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);
