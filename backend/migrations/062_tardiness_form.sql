-- Migration 062: 遅刻・早退 (Tardiness / Early Departure)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- ※控除対象 — subject to pay deduction.
-- App number prefix: TRD

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'TARDINESS',
  'Tardiness / Early Departure',
  '遅刻・早退',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）遅刻届 2026年7月1日",
        "show_in_row": true
      },
      {
        "name":     "is_late",
        "label":    "遅刻",
        "label_en": "Tardiness",
        "type":     "checkbox",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":     "is_early_leave",
        "label":    "早退",
        "label_en": "Early Departure",
        "type":     "checkbox",
        "required": false,
        "col_span": "quarter"
      },
      {
        "name":     "incident_date",
        "label":    "日付",
        "label_en": "Date",
        "type":     "date",
        "required": true,
        "col_span": "quarter"
      },
      {
        "name":        "actual_time",
        "label":       "出勤・退勤した時刻",
        "label_en":    "Actual Arrival / Departure Time",
        "type":        "time",
        "required":    true,
        "col_span":    "quarter"
      },
      {
        "name":     "reason",
        "label":    "理由",
        "label_en": "Reason",
        "type":     "textarea",
        "required": true,
        "col_span": "full"
      },
      {
        "name":          "contact_time_attachment",
        "label":         "連絡時間",
        "label_en":      "Contact Time Record",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "※遅刻の場合は、連絡時間のわかるものを添付してください"
      },
      {
        "name":          "delay_certificate",
        "label":         "遅延証明書",
        "label_en":      "Delay Certificate",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "※交通機関の遅延による遅刻の場合は遅延証明書を添付してください"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '⏰',
  'from-rose-400 to-red-500',
  '遅刻・早退の届出フォーム（控除対象）',
  'Notification for tardiness or early departure (subject to pay deduction)',
  'TRD',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'TARDINESS'
);
