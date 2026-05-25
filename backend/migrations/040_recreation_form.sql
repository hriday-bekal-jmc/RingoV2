-- Migration 040: Recreation (レクリエーション) form template
--
-- Pattern 2 (ringi → settlement).
-- Key new field types used: user_picker, formula (number with formula property).
-- App number prefix: RC

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  2,
  'RECREATION',
  'Recreation Expense',
  'レクリエーション費',
  '{
    "fields": [
      {
        "name": "title",
        "label": "件名",
        "label_en": "Subject",
        "type": "text",
        "required": true,
        "placeholder": "例）2025年度 部署レクリエーション",
        "show_in_row": true
      },
      {
        "name": "purpose",
        "label": "目的",
        "label_en": "Purpose",
        "type": "textarea",
        "required": true
      },
      {
        "name": "event_date",
        "label": "開催日",
        "label_en": "Event Date",
        "type": "date",
        "required": true
      },
      {
        "name": "venue",
        "label": "開催場所",
        "label_en": "Venue",
        "type": "text",
        "required": true
      },
      {
        "name": "venue_address",
        "label": "開催場所住所",
        "label_en": "Venue Address",
        "type": "text",
        "required": true
      },
      {
        "name": "planned_participants",
        "label": "参加予定者",
        "label_en": "Planned Participants",
        "type": "user_picker",
        "required": true,
        "count_field": "participant_count"
      },
      {
        "name": "participant_count",
        "label": "参加人数合計",
        "label_en": "Total Participants",
        "type": "number",
        "required": true,
        "computed": true,
        "show_in_row": true
      },
      {
        "name": "subsidy_amount",
        "label": "補助申請額",
        "label_en": "Subsidy Request Amount",
        "type": "number",
        "required": true,
        "computed": true,
        "formula": "participant_count * 2000",
        "show_in_row": true
      }
    ]
  }'::jsonb,
  '{
    "fields": [
      {
        "name": "actual_participants",
        "label": "参加者",
        "label_en": "Participants",
        "type": "user_picker",
        "required": true,
        "count_field": "actual_count"
      },
      {
        "name": "actual_count",
        "label": "参加人数合計",
        "label_en": "Total Participants",
        "type": "number",
        "required": true,
        "computed": true
      },
      {
        "name": "receipts",
        "label": "領収書",
        "label_en": "Receipts",
        "type": "repeat_group",
        "required": false,
        "min_rows": 0,
        "add_label": "領収書を追加",
        "add_label_en": "Add Receipt",
        "fields": [
          {
            "name": "receipt_file",
            "label": "領収書ファイル",
            "label_en": "Receipt File",
            "type": "ai_file_reader",
            "required": false,
            "file_category": "receipts",
            "target_amount_field": "receipt_amount"
          },
          {
            "name": "receipt_number",
            "label": "領収書番号",
            "label_en": "Receipt No.",
            "type": "text",
            "required": true,
            "placeholder": "例）001"
          },
          {
            "name": "receipt_amount",
            "label": "金額",
            "label_en": "Amount",
            "type": "number",
            "required": true,
            "validation": { "min": 0 }
          }
        ]
      },
      {
        "name": "receipt_total",
        "label": "領収書合計",
        "label_en": "Receipt Total",
        "type": "number",
        "required": false,
        "computed": true,
        "sum_target": "receipts",
        "sum_field": "receipt_amount"
      },
      {
        "name": "final_subsidy",
        "label": "補助申請額",
        "label_en": "Final Subsidy Amount",
        "type": "number",
        "required": true,
        "computed": true,
        "formula": "Math.min(actual_count * 2000, receipt_total || actual_count * 2000)",
        "show_in_row": true
      },
      {
        "name": "transfer_date",
        "label": "振込予定日",
        "label_en": "Transfer Date",
        "type": "date",
        "required": false
      }
    ]
  }'::jsonb,
  TRUE,
  FALSE,
  '🎉',
  'from-pink-400 to-rose-500',
  'レクリエーション費補助申請',
  'Recreation expense subsidy application',
  'RC',
  6
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'RECREATION'
);

-- Initial active version
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft
WHERE ft.code = 'RECREATION'
  AND NOT EXISTS (
    SELECT 1 FROM form_template_versions WHERE template_id = ft.id
  );
