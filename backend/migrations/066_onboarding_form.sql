-- Migration 066: 入社時申請 (New Employee Onboarding Application)
--
-- Pattern 1 (Ringi only — no settlement phase).
-- Submitted by new employees at time of joining.
-- Covers: employment insurance number, bank account, commute allowance (3 routes),
--         housing allowance, and dependents.
-- App number prefix: ONB
--
-- NOTE: Update helper_text URLs for:
--   - electronic_payment_consent : Google Forms link for 電子支付の総合申請フォーム
--   - housing_allowance           : Google Docs link for 手当規定

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'ONBOARDING',
  'New Employee Onboarding',
  '入社時申請',
  '{
    "fields": [
      {
        "name":          "subject",
        "label":         "件名",
        "label_en":      "Subject",
        "type":          "text",
        "required":      false,
        "default_value": "入社手続きに係る申請",
        "show_in_row":   true
      },

      {
        "name":  "header_insurance",
        "label": "雇用保険番号",
        "type":  "header"
      },
      {
        "name":     "employment_insurance_number",
        "label":    "雇用保険番号",
        "label_en": "Employment Insurance Number",
        "type":     "text",
        "required": false,
        "col_span": "half"
      },

      {
        "name":  "header_bank",
        "label": "口座情報",
        "type":  "header"
      },
      {
        "name":     "account_holder",
        "label":    "口座名義人",
        "label_en": "Account Holder Name",
        "type":     "text",
        "required": false,
        "col_span": "half"
      },
      {
        "name":        "account_holder_kana",
        "label":       "フリガナ",
        "label_en":    "Account Holder (Kana)",
        "type":        "text",
        "required":    false,
        "col_span":    "half",
        "placeholder": "カタカナで記入"
      },
      {
        "name":     "bank_name",
        "label":    "銀行名",
        "label_en": "Bank Name",
        "type":     "text",
        "required": false,
        "col_span": "half"
      },
      {
        "name":     "branch_name",
        "label":    "支店名",
        "label_en": "Branch Name",
        "type":     "text",
        "required": false,
        "col_span": "half"
      },
      {
        "name":     "account_number",
        "label":    "口座番号",
        "label_en": "Account Number",
        "type":     "text",
        "required": false,
        "col_span": "third"
      },
      {
        "name":        "electronic_payment_consent",
        "label":       "電子支付への同意",
        "label_en":    "Consent to Electronic Payment",
        "type":        "checkbox",
        "required":    true,
        "col_span":    "full",
        "helper_text": "電子支付の総合申請フォーム: https://forms.gle/GqxQFHUflp8UPNdZ8"
      },

      {
        "name":  "header_commute",
        "label": "通勤手当",
        "type":  "header"
      },
      {
        "name":     "commute_method",
        "label":    "通勤方法",
        "label_en": "Commute Method",
        "type":     "select",
        "required": false,
        "col_span": "third",
        "options": [
          { "value": "public",   "label_ja": "公共交通機関", "label_en": "Public Transport" },
          { "value": "walking",  "label_ja": "徒歩",         "label_en": "Walking" },
          { "value": "bicycle",  "label_ja": "自転車",       "label_en": "Bicycle" },
          { "value": "car",      "label_ja": "車",           "label_en": "Car" }
        ]
      },
      {
        "name":        "route1_transport",
        "label":       "経路①　交通機関",
        "label_en":    "Route 1 — Transport",
        "type":        "text",
        "required":    false,
        "col_span":    "third",
        "placeholder": "例）JR京都線"
      },
      {
        "name":        "route1_section",
        "label":       "経路①　区間",
        "label_en":    "Route 1 — Section",
        "type":        "text",
        "required":    false,
        "col_span":    "third",
        "placeholder": "例）京都駅 → 茨木駅"
      },
      {
        "name":     "route1_quarterly_pass",
        "label":    "経路①　3ヶ月定期代",
        "label_en": "Route 1 — 3-Month Pass",
        "type":     "number",
        "required": false,
        "col_span": "quarter",
        "unit":     "円",
        "validation": { "min": 0 }
      },
      {
        "name":        "route2_transport",
        "label":       "経路②　交通機関",
        "label_en":    "Route 2 — Transport",
        "type":        "text",
        "required":    false,
        "col_span":    "third",
        "placeholder": "例）大阪メトロ中央線"
      },
      {
        "name":        "route2_section",
        "label":       "経路②　区間",
        "label_en":    "Route 2 — Section",
        "type":        "text",
        "required":    false,
        "col_span":    "third",
        "placeholder": "例）茨木駅 → 梅田駅"
      },
      {
        "name":     "route2_quarterly_pass",
        "label":    "経路②　3ヶ月定期代",
        "label_en": "Route 2 — 3-Month Pass",
        "type":     "number",
        "required": false,
        "col_span": "quarter",
        "unit":     "円",
        "validation": { "min": 0 }
      },
      {
        "name":     "route3_transport",
        "label":    "経路③　交通機関",
        "label_en": "Route 3 — Transport",
        "type":     "text",
        "required": false,
        "col_span": "third"
      },
      {
        "name":     "route3_section",
        "label":    "経路③　区間",
        "label_en": "Route 3 — Section",
        "type":     "text",
        "required": false,
        "col_span": "third"
      },
      {
        "name":     "route3_quarterly_pass",
        "label":    "経路③　3ヶ月定期代",
        "label_en": "Route 3 — 3-Month Pass",
        "type":     "number",
        "required": false,
        "col_span": "quarter",
        "unit":     "円",
        "validation": { "min": 0 }
      },
      {
        "name":          "commuter_pass_receipt",
        "label":         "定期領収",
        "label_en":      "Commuter Pass Receipt",
        "type":          "file",
        "required":      false,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "定期購入がまだの場合は、購入後「総務部」までご提出ください"
      },
      {
        "name":     "quarterly_total",
        "label":    "3か月定期代合計金額",
        "label_en": "Total 3-Month Pass Cost",
        "type":     "number",
        "computed": true,
        "formula":  "route1_quarterly_pass + route2_quarterly_pass + route3_quarterly_pass",
        "col_span": "half",
        "unit":     "円",
        "helper_text": "こちらの値は自動計算されます"
      },

      {
        "name":  "header_housing",
        "label": "住宅申請",
        "type":  "header"
      },
      {
        "name":        "current_address",
        "label":       "現住所",
        "label_en":    "Current Address",
        "type":        "textarea",
        "required":    true,
        "col_span":    "half",
        "placeholder": "（〒）"
      },
      {
        "name":        "registered_address",
        "label":       "住民票住所",
        "label_en":    "Registered Address",
        "type":        "textarea",
        "required":    false,
        "col_span":    "half",
        "placeholder": "（〒）",
        "helper_text": "現住所と同じ場合は、同上"
      },
      {
        "name":        "housing_allowance",
        "label":       "住宅手当の有無",
        "label_en":    "Housing Allowance",
        "type":        "select",
        "required":    false,
        "col_span":    "quarter",
        "options": [
          { "value": "none", "label_ja": "無", "label_en": "No" },
          { "value": "yes",  "label_ja": "有", "label_en": "Yes" }
        ],
        "default_value": "none",
        "helper_text":   "※虚偽の申告または変更事項の未申告が判明した場合は、当該の返還を求めるほか、会社が行う調査および対処置に従うものとし、就業規則に基づく制裁（懲戒解雇を含む）の対象となる場合があります。\n※通勤手当、住宅手当ともに変更があった場合も速やかに申請を行ってください。"
      },

      {
        "name":  "header_dependents",
        "label": "扶養家族について",
        "type":  "header"
      },
      {
        "name":     "dependents",
        "label":    "扶養家族",
        "label_en": "Dependents",
        "type":     "select",
        "required": false,
        "col_span": "quarter",
        "options": [
          { "value": "none", "label_ja": "無", "label_en": "None" },
          { "value": "yes",  "label_ja": "有", "label_en": "Yes" }
        ],
        "default_value": "none"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '🏢',
  'from-indigo-400 to-violet-500',
  '入社時に提出する各種手続き申請フォーム',
  'New employee onboarding application covering bank account, commute, housing and dependents',
  'ONB',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'ONBOARDING'
);
