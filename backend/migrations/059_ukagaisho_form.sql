-- Migration 059: 伺書 (General Memo / Inquiry) form template
--
-- Pattern 1 (Ringi only — no settlement phase).
-- General-purpose internal memo for seeking approval on any matter.
-- App number prefix: UKG

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'UKAGAISHO',
  'Memo / Inquiry',
  '伺書',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）〇〇の件につきまして",
        "show_in_row": true
      },
      {
        "name":        "content",
        "label":       "内容",
        "label_en":    "Content",
        "type":        "textarea",
        "required":    true,
        "placeholder": "伺いの内容を記入してください",
        "col_span":    "full"
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
  '📋',
  'from-sky-400 to-blue-500',
  '社内稟議・伺い事項の申請フォーム',
  'General internal memo for seeking approval on any matter',
  'UKG',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'UKAGAISHO'
);
