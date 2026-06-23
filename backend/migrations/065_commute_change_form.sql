-- Migration 065: 通勤変更届 (Commute Change Notification)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Submitted when commute method or commuter pass amount changes.
-- App number prefix: COM
--
-- NOTE: Update the helper_text URL on the transport_application field below
--       with the full Google Sheets link for 【様式②】交通費変更申請書.

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'COMMUTE_CHANGE',
  'Commute Change Notification',
  '通勤変更届',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）通勤経路変更届 2026年7月",
        "show_in_row": true
      },
      {
        "name":     "change_date",
        "label":    "変更（予定）日",
        "label_en": "Change Date",
        "type":     "date",
        "required": true,
        "col_span": "quarter"
      },
      {
        "name":  "header_public_transport",
        "label": "公共交通機関の場合",
        "type":  "header"
      },
      {
        "name":          "transport_application",
        "label":         "申請書",
        "label_en":      "Application Form",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "以下をコピーして作成\n【様式②】交通費変更申請書（2025/4/1～）"
      },
      {
        "name":          "commuter_pass_receipt",
        "label":         "定期領収",
        "label_en":      "Commuter Pass Receipt",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full"
      },
      {
        "name":  "header_other_commute",
        "label": "徒歩・自転車・車通勤の場合",
        "type":  "header"
      },
      {
        "name":     "home_distance",
        "label":    "自宅から会社までの距離",
        "label_en": "Distance from Home to Office",
        "type":     "number",
        "required": false,
        "col_span": "quarter",
        "unit":     "km",
        "validation": { "min": 0 }
      },
      {
        "name":        "notes",
        "label":       "その他備考",
        "label_en":    "Notes",
        "type":        "textarea",
        "required":    false,
        "col_span":    "full",
        "helper_text": "※虚偽の申告または変更事項の未申告が判明した場合は、当該の返還を求めるほか、会社が行う調査および対処置に従うものとし、就業規則に基づく制裁（懲戒解雇を含む）の対象となる場合があります。"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '🚃',
  'from-teal-400 to-cyan-500',
  '通勤方法・定期代変更時の届出フォーム',
  'Notification for changes in commute method or commuter pass',
  'COM',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'COMMUTE_CHANGE'
);
