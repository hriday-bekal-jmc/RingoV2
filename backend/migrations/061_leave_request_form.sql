-- Migration 061: 有休・代休・特別休暇 (Paid / Compensatory / Special Leave Request)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Covers full-day and hourly leave. Attachment required for same-day paid leave.
-- App number prefix: LVE

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'LEAVE_REQUEST',
  'Leave Request',
  '有休・代休・特別休暇',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）有休取得申請 2026年7月1日",
        "show_in_row": true
      },
      {
        "name":     "leave_type",
        "label":    "項目",
        "label_en": "Leave Type",
        "type":     "select",
        "required": true,
        "col_span": "third",
        "options": [
          { "value": "paid",        "label_ja": "有休",       "label_en": "Paid Leave" },
          { "value": "compensatory","label_ja": "代休",       "label_en": "Compensatory Leave" },
          { "value": "doron",       "label_ja": "ドロン休暇", "label_en": "Doron Leave" },
          { "value": "special",     "label_ja": "特別休暇",   "label_en": "Special Leave" }
        ]
      },
      {
        "name":     "start_date",
        "label":    "開始日",
        "label_en": "Start Date",
        "type":     "date",
        "required": true,
        "col_span": "quarter"
      },
      {
        "name":       "end_date",
        "label":      "終了日",
        "label_en":   "End Date",
        "type":       "date",
        "required":   true,
        "col_span":   "quarter",
        "validation": { "date_after_or_equal": "start_date" }
      },
      {
        "name":            "total_days",
        "label":           "合計日数",
        "label_en":        "Total Days",
        "type":            "number",
        "computed":        true,
        "date_diff_from":  "start_date",
        "date_diff_to":    "end_date",
        "col_span":        "quarter",
        "unit":            "日"
      },
      {
        "name":     "start_time",
        "label":    "開始時間",
        "label_en": "Start Time",
        "type":     "time",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":     "end_time",
        "label":    "終了時間",
        "label_en": "End Time",
        "type":     "time",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":        "reason",
        "label":       "理由",
        "label_en":    "Reason",
        "type":        "textarea",
        "required":    false,
        "col_span":    "full",
        "helper_text": "※当日申請の有休は事由を記入\n※特別休暇の場合は、該当する内容を記入"
      },
      {
        "name":          "attachment",
        "label":         "添付",
        "label_en":      "Attachment",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "※当日申請の有休は、連絡時間の分かるものの添付が必要"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '🌿',
  'from-emerald-400 to-teal-500',
  '有給休暇・代休・特別休暇の取得申請フォーム',
  'Application for paid leave, compensatory leave, or special leave',
  'LVE',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'LEAVE_REQUEST'
);

-- Patch if already inserted (re-run safe)
UPDATE form_template_versions ftv
SET schema_definition = '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）有休取得申請 2026年7月1日",
        "show_in_row": true
      },
      {
        "name":     "leave_type",
        "label":    "項目",
        "label_en": "Leave Type",
        "type":     "select",
        "required": true,
        "col_span": "third",
        "options": [
          { "value": "paid",        "label_ja": "有休",       "label_en": "Paid Leave" },
          { "value": "compensatory","label_ja": "代休",       "label_en": "Compensatory Leave" },
          { "value": "doron",       "label_ja": "ドロン休暇", "label_en": "Doron Leave" },
          { "value": "special",     "label_ja": "特別休暇",   "label_en": "Special Leave" }
        ]
      },
      {
        "name":     "start_date",
        "label":    "開始日",
        "label_en": "Start Date",
        "type":     "date",
        "required": true,
        "col_span": "quarter"
      },
      {
        "name":       "end_date",
        "label":      "終了日",
        "label_en":   "End Date",
        "type":       "date",
        "required":   true,
        "col_span":   "quarter",
        "validation": { "date_after_or_equal": "start_date" }
      },
      {
        "name":            "total_days",
        "label":           "合計日数",
        "label_en":        "Total Days",
        "type":            "number",
        "computed":        true,
        "date_diff_from":  "start_date",
        "date_diff_to":    "end_date",
        "col_span":        "quarter",
        "unit":            "日"
      },
      {
        "name":     "start_time",
        "label":    "開始時間",
        "label_en": "Start Time",
        "type":     "time",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":     "end_time",
        "label":    "終了時間",
        "label_en": "End Time",
        "type":     "time",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":        "reason",
        "label":       "理由",
        "label_en":    "Reason",
        "type":        "textarea",
        "required":    false,
        "col_span":    "full",
        "helper_text": "※当日申請の有休は事由を記入\n※特別休暇の場合は、該当する内容を記入"
      },
      {
        "name":          "attachment",
        "label":         "添付",
        "label_en":      "Attachment",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "※当日申請の有休は、連絡時間の分かるものの添付が必要"
      }
    ]
  }'
FROM form_templates ft
WHERE ft.code         = 'LEAVE_REQUEST'
  AND ftv.template_id = ft.id
  AND ftv.is_active   = TRUE;
