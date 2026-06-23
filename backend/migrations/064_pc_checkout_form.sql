-- Migration 064: PC持ち出し (PC / Laptop Removal Request)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Employee requests permission to take a company PC off-premises.
-- App number prefix: PCO

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'PC_CHECKOUT',
  'PC Take-out Request',
  'PC持ち出し',
  '{
    "fields": [
      {
        "name":          "subject",
        "label":         "件名",
        "label_en":      "Subject",
        "type":          "text",
        "required":      true,
        "default_value": "PC持ち出し申請",
        "show_in_row":   true
      },
      {
        "name":        "content",
        "label":       "内容",
        "label_en":    "Content",
        "type":        "textarea",
        "required":    true,
        "col_span":    "full",
        "placeholder": "持ち出し期間：\n使用理由："
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '💻',
  'from-slate-400 to-zinc-500',
  '社外へのPC持ち出し申請フォーム',
  'Request to take a company PC off-premises',
  'PCO',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'PC_CHECKOUT'
);
