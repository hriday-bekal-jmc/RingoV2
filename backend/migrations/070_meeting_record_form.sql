-- Migration 070: 会議内容確認書 [MT] (Meeting Record / Expense Confirmation)
--
-- Pattern 3 (稟議→精算).
--   Ringi      : pre-approval — planned date, venue, attendees, agenda, estimated cost
--   Settlement : post-meeting record — minutes, 3-category expense breakdown, auto total
--
-- Expense categories in settlement:
--   会議費    (meeting expenses)
--   交際費    (entertainment expenses)
--   その他費用 (other expenses)
--   計        (auto-computed total)
--
-- App prefix : MT
-- Icon       : 📋

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  3,
  'MEETING_RECORD',
  'Meeting Record',
  '会議内容確認書',
  -- ─────────────────────── RINGI SCHEMA (伺い) ───────────────────────
  '{
    "fields": [
      {
        "name":          "subject",
        "label":         "件名",
        "label_en":      "Subject",
        "type":          "text",
        "required":      true,
        "default_value": "会議内容確認書",
        "show_in_row":   true
      },
      {
        "name":  "meeting_group",
        "label": "会議情報",
        "type":  "field_group",
        "fields": [
          {
            "name":     "planned_date",
            "label":    "実施予定日",
            "label_en": "Planned Date",
            "type":     "date",
            "required": true,
            "col_span": "quarter"
          },
          {
            "name":        "location",
            "label":       "地所（場所）",
            "label_en":    "Venue",
            "type":        "text",
            "required":    true,
            "col_span":    "half",
            "placeholder": "例）本社会議室、〇〇ホテル"
          },
          {
            "name":       "estimated_amount",
            "label":      "概算費用",
            "label_en":   "Estimated Cost",
            "type":       "number",
            "required":   false,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          }
        ]
      },
      {
        "name":        "attendees",
        "label":       "出席者",
        "label_en":    "Attendees",
        "type":        "user_picker",
        "required":    false,
        "col_span":    "full",
        "helper_text": "社外ゲストは下部の「名前を直接追加」から入力できます"
      },
      {
        "name":        "agenda",
        "label":       "議事内容（予定）",
        "label_en":    "Agenda",
        "type":        "textarea",
        "required":    true,
        "col_span":    "full",
        "placeholder": "会議の目的・議題・予定内容を記入してください"
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
        "label": "実施情報",
        "type":  "field_group",
        "fields": [
          {
            "name":      "actual_date",
            "label":     "実施日",
            "label_en":  "Date Held",
            "type":      "date",
            "required":  true,
            "col_span":  "quarter"
          },
          {
            "name":      "location",
            "label":     "地所（場所）",
            "label_en":  "Venue",
            "type":      "text",
            "required":  true,
            "col_span":  "half",
            "copy_from": "location"
          }
        ]
      },
      {
        "name":        "attendees",
        "label":       "出席者",
        "label_en":    "Attendees",
        "type":        "user_picker",
        "required":    false,
        "col_span":    "full",
        "copy_from":   "attendees",
        "helper_text": "社外ゲストは下部の「名前を直接追加」から入力できます"
      },
      {
        "name":        "meeting_content",
        "label":       "議事内容",
        "label_en":    "Meeting Minutes",
        "type":        "textarea",
        "required":    true,
        "col_span":    "full",
        "placeholder": "会議で議論・決定した内容を記入してください"
      },
      {
        "name":  "expense_group",
        "label": "費用科目の区分",
        "type":  "field_group",
        "fields": [
          {
            "name":        "meeting_fee_detail",
            "label":       "会議費　明細",
            "label_en":    "Meeting Expenses — Detail",
            "type":        "text",
            "required":    false,
            "col_span":    "half",
            "placeholder": "例）会場費、資料印刷代"
          },
          {
            "name":       "meeting_fee_amount",
            "label":      "会議費　金額",
            "label_en":   "Meeting Expenses — Amount",
            "type":       "number",
            "required":   false,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          },
          {
            "name":        "entertainment_fee_detail",
            "label":       "交際費　明細",
            "label_en":    "Entertainment — Detail",
            "type":        "text",
            "required":    false,
            "col_span":    "half",
            "placeholder": "例）飲食代、手土産代"
          },
          {
            "name":       "entertainment_fee_amount",
            "label":      "交際費　金額",
            "label_en":   "Entertainment — Amount",
            "type":       "number",
            "required":   false,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          },
          {
            "name":        "other_fee_detail",
            "label":       "その他費用　明細",
            "label_en":    "Other Expenses — Detail",
            "type":        "text",
            "required":    false,
            "col_span":    "half",
            "placeholder": "例）交通費、備品代"
          },
          {
            "name":       "other_fee_amount",
            "label":      "その他費用　金額",
            "label_en":   "Other Expenses — Amount",
            "type":       "number",
            "required":   false,
            "col_span":   "quarter",
            "unit":       "円",
            "validation": { "min": 0 }
          },
          {
            "name":         "total_amount",
            "label":        "計",
            "label_en":     "Total",
            "type":         "number",
            "computed":     true,
            "formula":      "meeting_fee_amount + entertainment_fee_amount + other_fee_amount",
            "unit":         "円",
            "col_span":     "quarter",
            "show_in_row":  true,
            "amount_field": true
          }
        ]
      },
      {
        "name":        "recipient_name",
        "label":       "受給者氏名",
        "label_en":    "Recipient Name",
        "type":        "text",
        "required":    false,
        "col_span":    "half",
        "helper_text": "精算金額がある場合、受取人の氏名を記入"
      },
      {
        "name":          "receipts",
        "label":         "領収書",
        "label_en":      "Receipts",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "費用が発生した場合は領収書を添付してください"
      }
    ]
  }',
  TRUE,
  FALSE,
  '📋',
  'from-sky-400 to-blue-500',
  '会議の実施報告と関連費用の精算を一括管理するフォーム',
  'Meeting record with post-meeting minutes and expense settlement by category',
  'MT',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'MEETING_RECORD'
);

-- Version record — required for form builder display
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'MEETING_RECORD'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);
