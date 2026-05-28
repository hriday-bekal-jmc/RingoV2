-- Migration 050: Salary Bank Account Change (給与振込口座変更届) form template
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Employee notifies HR of a new or changed salary deposit bank account.
-- App number prefix: BNK

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'SALARY_BANK',
  'Salary Bank Account Change',
  '給与振込口座変更届',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）給与振込口座変更届 2026年6月",
        "show_in_row": true
      },
      {
        "name":     "change_type",
        "label":    "申請種別",
        "label_en": "Request Type",
        "type":     "select",
        "required": true,
        "options": [
          { "value": "new",    "label_ja": "新規",   "label_en": "New Registration" },
          { "value": "change", "label_ja": "変更",   "label_en": "Change" }
        ]
      },
      {
        "name":        "employee_name_kana",
        "label":       "氏名（フリガナ）",
        "label_en":    "Full Name (Kana)",
        "type":        "text",
        "required":    true,
        "placeholder": "例）ヤマダ タロウ"
      },
      {
        "name":        "bank_name",
        "label":       "銀行名",
        "label_en":    "Bank Name",
        "type":        "text",
        "required":    true,
        "placeholder": "例）三菱UFJ銀行"
      },
      {
        "name":        "bank_code",
        "label":       "銀行番号",
        "label_en":    "Bank Code",
        "type":        "text",
        "required":    true,
        "placeholder": "例）0005",
        "validation":  { "pattern": "^\\d{4}$", "patternMessage": "半角数字4桁で入力してください" }
      },
      {
        "name":        "branch_name",
        "label":       "支店名",
        "label_en":    "Branch Name",
        "type":        "text",
        "required":    true,
        "placeholder": "例）渋谷支店"
      },
      {
        "name":        "branch_code",
        "label":       "支店番号",
        "label_en":    "Branch Code",
        "type":        "text",
        "required":    true,
        "placeholder": "例）123",
        "validation":  { "pattern": "^\\d{3}$", "patternMessage": "半角数字3桁で入力してください" }
      },
      {
        "name":     "account_type",
        "label":    "預金種別",
        "label_en": "Account Type",
        "type":     "select",
        "required": true,
        "options": [
          { "value": "futsu",  "label_ja": "普通", "label_en": "Ordinary" },
          { "value": "toza",   "label_ja": "当座", "label_en": "Current" }
        ]
      },
      {
        "name":        "account_number",
        "label":       "口座番号",
        "label_en":    "Account Number",
        "type":        "text",
        "required":    true,
        "placeholder": "例）1234567",
        "validation":  { "pattern": "^\\d{7}$", "patternMessage": "半角数字7桁で入力してください" }
      },
      {
        "name":        "account_holder_kana",
        "label":       "口座名義人",
        "label_en":    "Account Holder Name",
        "type":        "text",
        "required":    true,
        "placeholder": "フリガナ（カタカナ）で入力してください"
      },
      {
        "name":        "remarks",
        "label":       "備考",
        "label_en":    "Remarks",
        "type":        "textarea",
        "required":    false,
        "placeholder": "その他特記事項があれば記入してください"
      }
    ]
  }'::jsonb,
  NULL,
  TRUE,
  FALSE,
  '🏦',
  'from-emerald-400 to-teal-600',
  '給与振込口座を新規登録もしくは変更する際に申請してください。',
  'Submit when registering a new or changing an existing salary deposit bank account.',
  'BNK',
  6
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'SALARY_BANK'
);

-- Initial active version
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft
WHERE ft.code = 'SALARY_BANK'
  AND NOT EXISTS (
    SELECT 1 FROM form_template_versions WHERE template_id = ft.id
  );
