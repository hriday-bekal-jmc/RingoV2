-- Migration 060: 事務所閉鎖時・早出・作業延長 (Office Closure / Early Arrival / Overtime Work)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Staff apply for after-hours, early-start, or overtime work at the office.
-- Core data is a repeatable group of work sessions (date, time range, task, person, compensatory leave).
-- App number prefix: OVT

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'OFFICE_OVERTIME',
  'Office Closure / Overtime Work',
  '事務所閉鎖時・早出・作業延長',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）6月度 早出・作業延長申請",
        "show_in_row": true
      },
      {
        "name":         "work_entries",
        "label":        "作業予定",
        "label_en":     "Work Schedule",
        "type":         "repeat_group",
        "required":     true,
        "min_rows":     1,
        "add_label":    "行を追加",
        "add_label_en": "Add row",
        "col_span":     "full",
        "fields": [
          {
            "name":     "work_date",
            "label":    "日付",
            "label_en": "Date",
            "type":     "date",
            "required": true,
            "col_span": "quarter"
          },
          {
            "name":     "start_time",
            "label":    "開始時間",
            "label_en": "Start Time",
            "type":     "time",
            "required": true,
            "col_span": "quarter"
          },
          {
            "name":     "end_time",
            "label":    "終了時間",
            "label_en": "End Time",
            "type":     "time",
            "required": true,
            "col_span": "quarter",
            "validation": { "min_time_field": "start_time" }
          },
          {
            "name":        "task",
            "label":       "業務",
            "label_en":    "Task",
            "type":        "textarea",
            "required":    true,
            "col_span":    "half"
          },
          {
            "name":        "person",
            "label":       "担当者",
            "label_en":    "Person in Charge",
            "type":        "text",
            "required":    true,
            "col_span":    "quarter"
          },
          {
            "name":     "compensatory_leave",
            "label":    "代休",
            "label_en": "Comp. Leave",
            "type":     "select",
            "required": true,
            "col_span": "quarter",
            "default_value": "none",
            "options": [
              { "value": "none", "label_ja": "無", "label_en": "No" },
              { "value": "yes",  "label_ja": "有", "label_en": "Yes" }
            ]
          }
        ]
      },
      {
        "name":          "attachment",
        "label":         "添付ファイル",
        "label_en":      "Attachment",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '🏢',
  'from-violet-400 to-purple-500',
  '事務所閉鎖時・早出・作業延長の申請フォーム',
  'Application for after-hours, early-start, or overtime work at the office',
  'OVT',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'OFFICE_OVERTIME'
);
