-- Migration 068: 祝い金補助申請 (Birthday Celebration Subsidy Application)
--
-- Pattern 1 (稟議のみ — no settlement phase).
-- Employee applies for birthday celebration subsidy after holding a celebration.
--
-- Two subsidy tiers (participant_type determines amount):
--   条件①: 自身の両親または配偶者の両親が参加         → ¥20,000
--   条件②: 両親以外の家族、または社外の友人が参加     → ¥10,000
--
-- Additional conditions:
--   ・お祝い本人と参加者の顔が分かる写真を必ず添付
--   ・お祝い実施後 1 ヶ月以内に申請
--
-- Approval route: GM → 専務 → 社長（回覧：椋本、古澤）
-- Payment:        原則手渡しにて支給
-- App prefix:     IWI

INSERT INTO form_templates (
  pattern_id, code, title, title_ja,
  schema_definition, settlement_schema,
  is_active, is_protected,
  icon, gradient, description_ja, description_en,
  app_number_prefix, app_number_digits
)
SELECT
  1,
  'IWAI_GRANT',
  'Birthday Celebration Subsidy',
  '祝い金補助申請',
  '{
    "fields": [
      {
        "name":          "subject",
        "label":         "件名",
        "label_en":      "Subject",
        "type":          "text",
        "required":      true,
        "default_value": "祝い金補助申請",
        "show_in_row":   true
      },
      {
        "name":  "basics_group",
        "label": "申請内容",
        "type":  "field_group",
        "fields": [
          {
            "name":        "applicant_birthday",
            "label":       "本人（申請者）誕生日",
            "label_en":    "Applicant Birthday",
            "type":        "date",
            "required":    true,
            "col_span":    "quarter",
            "helper_text": "申請者本人の誕生日"
          },
          {
            "name":        "celebration_date",
            "label":       "お祝い実施日",
            "label_en":    "Celebration Date",
            "type":        "date",
            "required":    true,
            "col_span":    "quarter",
            "helper_text": "実際にお祝いを行った日付"
          }
        ]
      },
      {
        "name":  "participant_group",
        "label": "参加者区分・支給金額",
        "type":  "field_group",
        "fields": [
          {
            "name":     "participant_type",
            "label":    "参加者区分（該当に○）",
            "label_en": "Participant Category",
            "type":     "select",
            "required": true,
            "col_span": "full",
            "options": [
              {
                "value":    "parents",
                "label_ja": "条件① ― 自身の両親または配偶者の両親が参加　【支給金額：20,000円】",
                "label_en": "Condition ① — Own parents or spouse parents attended  [¥20,000]"
              },
              {
                "value":    "family_or_friends",
                "label_ja": "条件② ― 両親以外の家族、または社外の友人が参加　【支給金額：10,000円】",
                "label_en": "Condition ② — Other family or outside friends attended  [¥10,000]"
              }
            ],
            "helper_text": "※条件①と②は重複して申請できません。より高額な方を選択してください。"
          }
        ]
      },
      {
        "name":          "celebration_photos",
        "label":         "写真添付（必須）",
        "label_en":      "Celebration Photos (required)",
        "type":          "file",
        "required":      true,
        "file_category": "other",
        "col_span":      "full",
        "helper_text":   "※お祝い本人と参加者の顔が分かる写真を必ず添付してください。"
      },
      {
        "name":        "notes",
        "label":       "備考",
        "label_en":    "Notes",
        "type":        "textarea",
        "required":    false,
        "col_span":    "full",
        "placeholder": "その他、特記事項があれば記入してください。",
        "helper_text": "※お祝い実施後 1 ヶ月以内に申請してください。支給は原則手渡しとなります。"
      }
    ]
  }',
  NULL,
  TRUE,
  FALSE,
  '🎉',
  'from-pink-400 to-rose-500',
  '誕生日お祝いの実施後に提出する祝い金補助申請フォーム',
  'Birthday celebration subsidy application — submit within 1 month of the celebration',
  'IWI',
  4
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE code = 'IWAI_GRANT'
);

-- Create version record so the form appears in the form builder
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'IWAI_GRANT'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);
