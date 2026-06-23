-- Migration 067: Create missing versions for forms 059-066 + improve layouts
--
-- Every template needs a form_template_versions record for the builder to work.
-- Migrations 059-066 inserted form_templates but no versions — this patches all of them.
-- Complex forms (leave request, commute change, onboarding) get field_group layouts.

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: create version from current schema_definition, idempotent
-- ─────────────────────────────────────────────────────────────────────────────

-- 059 伺書 — schema fine as-is
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'UKAGAISHO'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

-- 060 事務所閉鎖時・早出・作業延長 — schema fine as-is
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'OFFICE_OVERTIME'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

-- 062 遅刻・早退 — schema fine as-is
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'TARDINESS'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

-- 063 始末書 — schema fine as-is
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'SHIMATSUSHO'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

-- 064 PC持ち出し — schema fine as-is
INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'PC_CHECKOUT'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 061 有休・代休・特別休暇 — improved layout with field_groups
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE form_templates SET schema_definition = '{
  "fields": [
    {
      "name": "subject", "label": "件名", "label_en": "Subject",
      "type": "text", "required": true,
      "placeholder": "例）有休取得申請 2026年7月1日", "show_in_row": true
    },
    {
      "name": "leave_type", "label": "項目", "label_en": "Leave Type",
      "type": "select", "required": true, "col_span": "third",
      "options": [
        { "value": "paid",        "label_ja": "有休",       "label_en": "Paid Leave" },
        { "value": "compensatory","label_ja": "代休",       "label_en": "Compensatory Leave" },
        { "value": "doron",       "label_ja": "ドロン休暇", "label_en": "Doron Leave" },
        { "value": "special",     "label_ja": "特別休暇",   "label_en": "Special Leave" }
      ]
    },
    {
      "name": "period_group", "label": "日時・時間", "type": "field_group",
      "fields": [
        {
          "name": "start_date", "label": "開始日", "label_en": "Start Date",
          "type": "date", "required": true, "col_span": "quarter"
        },
        {
          "name": "end_date", "label": "終了日", "label_en": "End Date",
          "type": "date", "required": true, "col_span": "quarter",
          "validation": { "date_after_or_equal": "start_date" }
        },
        {
          "name": "total_days", "label": "合計日数", "label_en": "Total Days",
          "type": "number", "computed": true,
          "date_diff_from": "start_date", "date_diff_to": "end_date",
          "col_span": "quarter", "unit": "日"
        },
        {
          "name": "start_time", "label": "開始時間", "label_en": "Start Time",
          "type": "time", "required": false, "col_span": "quarter"
        },
        {
          "name": "end_time", "label": "終了時間", "label_en": "End Time",
          "type": "time", "required": false, "col_span": "quarter"
        }
      ]
    },
    {
      "name": "reason", "label": "理由", "label_en": "Reason",
      "type": "textarea", "required": false, "col_span": "full",
      "helper_text": "※当日申請の有休は事由を記入\n※特別休暇の場合は、該当する内容を記入"
    },
    {
      "name": "attachment", "label": "添付", "label_en": "Attachment",
      "type": "file", "required": false, "file_category": "other", "col_span": "full",
      "helper_text": "※当日申請の有休は、連絡時間の分かるものの添付が必要"
    }
  ]
}' WHERE code = 'LEAVE_REQUEST';

INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'LEAVE_REQUEST'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

UPDATE form_template_versions ftv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE ft.code = 'LEAVE_REQUEST' AND ftv.template_id = ft.id AND ftv.is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 065 通勤変更届 — improved layout with field_groups
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE form_templates SET schema_definition = '{
  "fields": [
    {
      "name": "subject", "label": "件名", "label_en": "Subject",
      "type": "text", "required": true,
      "placeholder": "例）通勤経路変更届 2026年7月", "show_in_row": true
    },
    {
      "name": "change_date", "label": "変更（予定）日", "label_en": "Change Date",
      "type": "date", "required": true, "col_span": "quarter"
    },
    {
      "name": "public_transport_group", "label": "公共交通機関の場合", "type": "field_group",
      "fields": [
        {
          "name": "transport_application", "label": "申請書", "label_en": "Application Form",
          "type": "file", "required": false, "file_category": "other", "col_span": "full",
          "helper_text": "以下をコピーして作成\n【様式②】交通費変更申請書（2025/4/1～）"
        },
        {
          "name": "commuter_pass_receipt", "label": "定期領収", "label_en": "Commuter Pass Receipt",
          "type": "file", "required": false, "file_category": "other", "col_span": "full"
        }
      ]
    },
    {
      "name": "other_commute_group", "label": "徒歩・自転車・車通勤の場合", "type": "field_group",
      "fields": [
        {
          "name": "home_distance", "label": "自宅から会社までの距離", "label_en": "Distance from Home to Office",
          "type": "number", "required": false, "col_span": "quarter",
          "unit": "km", "validation": { "min": 0 }
        }
      ]
    },
    {
      "name": "notes", "label": "その他備考", "label_en": "Notes",
      "type": "textarea", "required": false, "col_span": "full",
      "helper_text": "※虚偽の申告または変更事項の未申告が判明した場合は、当該の返還を求めるほか、会社が行う調査および対処置に従うものとし、就業規則に基づく制裁（懲戒解雇を含む）の対象となる場合があります。"
    }
  ]
}' WHERE code = 'COMMUTE_CHANGE';

INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'COMMUTE_CHANGE'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

UPDATE form_template_versions ftv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE ft.code = 'COMMUTE_CHANGE' AND ftv.template_id = ft.id AND ftv.is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 066 入社時申請 — improved layout with field_groups per section
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE form_templates SET schema_definition = '{
  "fields": [
    {
      "name": "subject", "label": "件名", "label_en": "Subject",
      "type": "text", "required": false,
      "default_value": "入社手続きに係る申請", "show_in_row": true
    },
    {
      "name": "insurance_group", "label": "雇用保険番号", "type": "field_group",
      "fields": [
        {
          "name": "employment_insurance_number",
          "label": "雇用保険番号", "label_en": "Employment Insurance Number",
          "type": "text", "required": false, "col_span": "half"
        }
      ]
    },
    {
      "name": "bank_group", "label": "口座情報", "type": "field_group",
      "fields": [
        {
          "name": "account_holder", "label": "口座名義人", "label_en": "Account Holder Name",
          "type": "text", "required": false, "col_span": "half"
        },
        {
          "name": "account_holder_kana", "label": "フリガナ", "label_en": "Account Holder (Kana)",
          "type": "text", "required": false, "col_span": "half",
          "placeholder": "カタカナで記入"
        },
        {
          "name": "bank_name", "label": "銀行名", "label_en": "Bank Name",
          "type": "text", "required": false, "col_span": "third"
        },
        {
          "name": "branch_name", "label": "支店名", "label_en": "Branch Name",
          "type": "text", "required": false, "col_span": "third"
        },
        {
          "name": "account_number", "label": "口座番号", "label_en": "Account Number",
          "type": "text", "required": false, "col_span": "third"
        },
        {
          "name": "electronic_payment_consent",
          "label": "電子支付への同意", "label_en": "Consent to Electronic Payment",
          "type": "checkbox", "required": true, "col_span": "full",
          "helper_text": "電子支付の総合申請フォーム: https://forms.gle/GqxQFHUflp8UPNdZ8"
        }
      ]
    },
    {
      "name": "commute_group", "label": "通勤手当", "type": "field_group",
      "fields": [
        {
          "name": "commute_method", "label": "通勤方法", "label_en": "Commute Method",
          "type": "select", "required": false, "col_span": "third",
          "options": [
            { "value": "public",  "label_ja": "公共交通機関", "label_en": "Public Transport" },
            { "value": "walking", "label_ja": "徒歩",         "label_en": "Walking" },
            { "value": "bicycle", "label_ja": "自転車",       "label_en": "Bicycle" },
            { "value": "car",     "label_ja": "車",           "label_en": "Car" }
          ]
        },
        {
          "name": "route1_transport", "label": "経路①　交通機関", "label_en": "Route 1 — Transport",
          "type": "text", "required": false, "col_span": "third",
          "placeholder": "例）JR京都線"
        },
        {
          "name": "route1_section", "label": "経路①　区間", "label_en": "Route 1 — Section",
          "type": "text", "required": false, "col_span": "third",
          "placeholder": "例）京都駅 → 茨木駅"
        },
        {
          "name": "route1_quarterly_pass", "label": "経路①　3ヶ月定期代", "label_en": "Route 1 — 3-Month Pass",
          "type": "number", "required": false, "col_span": "quarter",
          "unit": "円", "validation": { "min": 0 }
        },
        {
          "name": "route2_transport", "label": "経路②　交通機関", "label_en": "Route 2 — Transport",
          "type": "text", "required": false, "col_span": "third",
          "placeholder": "例）大阪メトロ中央線"
        },
        {
          "name": "route2_section", "label": "経路②　区間", "label_en": "Route 2 — Section",
          "type": "text", "required": false, "col_span": "third",
          "placeholder": "例）茨木駅 → 梅田駅"
        },
        {
          "name": "route2_quarterly_pass", "label": "経路②　3ヶ月定期代", "label_en": "Route 2 — 3-Month Pass",
          "type": "number", "required": false, "col_span": "quarter",
          "unit": "円", "validation": { "min": 0 }
        },
        {
          "name": "route3_transport", "label": "経路③　交通機関", "label_en": "Route 3 — Transport",
          "type": "text", "required": false, "col_span": "third"
        },
        {
          "name": "route3_section", "label": "経路③　区間", "label_en": "Route 3 — Section",
          "type": "text", "required": false, "col_span": "third"
        },
        {
          "name": "route3_quarterly_pass", "label": "経路③　3ヶ月定期代", "label_en": "Route 3 — 3-Month Pass",
          "type": "number", "required": false, "col_span": "quarter",
          "unit": "円", "validation": { "min": 0 }
        },
        {
          "name": "commuter_pass_receipt", "label": "定期領収", "label_en": "Commuter Pass Receipt",
          "type": "file", "required": false, "file_category": "other", "col_span": "full",
          "helper_text": "定期購入がまだの場合は、購入後「総務部」までご提出ください"
        },
        {
          "name": "quarterly_total", "label": "3か月定期代合計金額", "label_en": "Total 3-Month Pass Cost",
          "type": "number", "computed": true,
          "formula": "route1_quarterly_pass + route2_quarterly_pass + route3_quarterly_pass",
          "col_span": "half", "unit": "円",
          "helper_text": "こちらの値は自動計算されます"
        }
      ]
    },
    {
      "name": "housing_group", "label": "住宅申請", "type": "field_group",
      "fields": [
        {
          "name": "current_address", "label": "現住所", "label_en": "Current Address",
          "type": "textarea", "required": true, "col_span": "half",
          "placeholder": "（〒）"
        },
        {
          "name": "registered_address", "label": "住民票住所", "label_en": "Registered Address",
          "type": "textarea", "required": false, "col_span": "half",
          "placeholder": "（〒）",
          "helper_text": "現住所と同じ場合は、同上"
        },
        {
          "name": "housing_allowance", "label": "住宅手当の有無", "label_en": "Housing Allowance",
          "type": "select", "required": false, "col_span": "quarter",
          "options": [
            { "value": "none", "label_ja": "無", "label_en": "No" },
            { "value": "yes",  "label_ja": "有", "label_en": "Yes" }
          ],
          "default_value": "none",
          "helper_text": "※虚偽の申告または変更事項の未申告が判明した場合は、当該の返還を求めるほか、会社が行う調査および対処置に従うものとし、就業規則に基づく制裁（懲戒解雇を含む）の対象となる場合があります。\n※通勤手当、住宅手当ともに変更があった場合も速やかに申請を行ってください。"
        }
      ]
    },
    {
      "name": "dependents_group", "label": "扶養家族について", "type": "field_group",
      "fields": [
        {
          "name": "dependents", "label": "扶養家族", "label_en": "Dependents",
          "type": "select", "required": false, "col_span": "quarter",
          "options": [
            { "value": "none", "label_ja": "無", "label_en": "None" },
            { "value": "yes",  "label_ja": "有", "label_en": "Yes" }
          ],
          "default_value": "none"
        }
      ]
    }
  ]
}' WHERE code = 'ONBOARDING';

INSERT INTO form_template_versions (template_id, version_number, schema_definition, settlement_schema, is_active, notes)
SELECT ft.id, 1, ft.schema_definition, ft.settlement_schema, TRUE, 'Initial version'
FROM form_templates ft WHERE ft.code = 'ONBOARDING'
  AND NOT EXISTS (SELECT 1 FROM form_template_versions WHERE template_id = ft.id);

UPDATE form_template_versions ftv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE ft.code = 'ONBOARDING' AND ftv.template_id = ft.id AND ftv.is_active = TRUE;
