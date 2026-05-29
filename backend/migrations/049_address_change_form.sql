-- Migration 049: Address Change Notification (住所変更届) form template
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Employee notifies HR of a residential address change.
-- Postal code split from address per design spec.
-- App number prefix: ADR

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'ADDRESS_CHANGE',
  'Address Change Notification',
  '住所変更届',
  '{
    "fields": [
      {
        "name":        "subject",
        "label":       "件名",
        "label_en":    "Subject",
        "type":        "text",
        "required":    true,
        "placeholder": "例）住所変更届 2026年5月",
        "show_in_row": true
      },
      {
        "name":     "change_date",
        "label":    "変更（予定）日",
        "label_en": "Change Date",
        "type":     "date",
        "required": true
      },
      {
        "name":        "new_postal_code",
        "label":       "新郵便番号",
        "label_en":    "New Postal Code",
        "type":        "text",
        "required":    true,
        "placeholder": "例）123-4567",
        "validation":  { "regex": "^\\d{3}-?\\d{4}$" }
      },
      {
        "name":        "new_address",
        "label":       "新住所",
        "label_en":    "New Address",
        "type":        "textarea",
        "required":    true,
        "placeholder": "例）東京都渋谷区〇〇町1-2-3 〇〇マンション101号室"
      },
      {
        "name":        "current_address",
        "label":       "現住所（変更前）",
        "label_en":    "Current Address (Before Change)",
        "type":        "textarea",
        "required":    true,
        "placeholder": "現在登録されている住所を入力してください"
      },
      {
        "name":     "housing_allowance",
        "label":    "住宅手当の有無",
        "label_en": "Housing Allowance",
        "type":     "select",
        "required": true,
        "options": [
          { "value": "none",   "label_ja": "なし",  "label_en": "None" },
          { "value": "rental", "label_ja": "あり（賃貸）", "label_en": "Yes (Rental)" },
          { "value": "owned",  "label_ja": "あり（持ち家）", "label_en": "Yes (Owned)" }
        ]
      },
      {
        "name":          "contract_file",
        "label":         "契約書・登記簿",
        "label_en":      "Contract / Title Deed",
        "type":          "file",
        "required":      false,
        "description_ja": "住宅手当申請中の場合は必須。賃貸：本人名義の賃貸契約書 / 持ち家：不動産登記簿またはローン契約書",
        "description_en": "Required if claiming housing allowance. Rental: lease in the applicant name. Owned: property deed or mortgage contract.",
        "accept":        ".pdf,.jpg,.jpeg,.png"
      },
      {
        "name":     "area",
        "label":    "エリア区分",
        "label_en": "Area Classification",
        "type":     "select",
        "required": true,
        "options": [
          { "value": "kinko",  "label_ja": "近郊", "label_en": "Near Area" },
          { "value": "enkyo",  "label_ja": "遠郊", "label_en": "Far Area" }
        ]
      },
      {
        "name":     "has_dependents",
        "label":    "扶養家族の同居人",
        "label_en": "Dependent Family Members (Co-residing)",
        "type":     "select",
        "required": true,
        "options": [
          { "value": "none", "label_ja": "なし", "label_en": "None" },
          { "value": "yes",  "label_ja": "あり", "label_en": "Yes"  }
        ]
      },
      {
        "name":     "remarks",
        "label":    "その他備考",
        "label_en": "Remarks",
        "type":     "textarea",
        "required": false,
        "placeholder": "通勤方法の変更・特記事項があれば記入してください"
      }
    ]
  }'::jsonb,
  NULL,
  TRUE,
  FALSE,
  '🏠',
  'from-sky-400 to-blue-600',
  '住所変更があった際に申請してください。住宅手当申請中の場合は証明書類を添付してください。',
  'Submit when your residential address changes. Attach supporting documents if claiming housing allowance.',
  'ADR',
  6
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'ADDRESS_CHANGE'
);

-- Initial active version
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft
WHERE ft.code = 'ADDRESS_CHANGE'
  AND NOT EXISTS (
    SELECT 1 FROM form_template_versions WHERE template_id = ft.id
  );
