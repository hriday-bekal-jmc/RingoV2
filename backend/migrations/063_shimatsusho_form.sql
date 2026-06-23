-- Migration 063: 始末書 (Written Apology / Incident Report)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Formal written apology submitted after a workplace incident or misconduct.
-- Attachment is required (physical document scan).
-- App number prefix: SMA

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'SHIMATSUSHO',
  'Written Apology',
  '始末書',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）〇〇に関する始末書",
        "show_in_row": true
      },
      {
        "name":     "content",
        "label":    "内容",
        "label_en": "Content",
        "type":     "textarea",
        "required": true,
        "col_span": "full"
      },
      {
        "name":          "attachment",
        "label":         "添付ファイル",
        "label_en":      "Attachment",
        "type":          "file",
        "required":      true,
        "file_category": "other",
        "col_span":      "full"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '📝',
  'from-warmgray-400 to-warmgray-600',
  '業務上の不始末・事故に関する始末書の提出フォーム',
  'Formal written apology for a workplace incident or misconduct',
  'SMA',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'SHIMATSUSHO'
);
