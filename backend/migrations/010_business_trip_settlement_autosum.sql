-- Migration 010: Full BUSINESS_TRIP schema — ringi + settlement
-- Idempotent — safe to re-run on existing DBs.
--
-- Ringi: repeatable accommodations, route_entry with travel dates
-- Settlement: repeatable accommodations, per-day allowances, repeatable other_expenses.
--
-- _daily_rate field: backend injects the applicant's role-based rate from allowance_rates table
-- at settlement form load time (GET /applications/:id → COALESCE(allowance_rates.daily_rate_yen,
-- users.daily_allowance_rate, 3000)). Rates are managed in Admin → 日当レート page.
-- Formula: daily_allowance_days_total * _daily_rate = daily_allowance_total

UPDATE form_templates
SET
  schema_definition = '{
    "fields": [
      {"name":"application_date","label":"申請日","label_en":"Application Date","type":"date","required":true,"default_value":"__today__"},
      {"name":"subject","label":"件名","label_en":"Subject","type":"text","required":true,"placeholder":"例）大阪出張 2025年6月","show_in_row":true},
      {"name":"destination","label":"出張先","label_en":"Destination","type":"text","required":true,"show_in_row":true},
      {"name":"purpose","label":"出張目的","label_en":"Purpose","type":"textarea","required":true},
      {"name":"departure_date","label":"出発日","label_en":"Departure Date","type":"date","required":true},
      {"name":"return_date","label":"帰着日","label_en":"Return Date","type":"date","required":true,"validation":{"date_after_or_equal":"departure_date"}},
      {"name":"companions","label":"同行者","label_en":"Accompanying Persons","type":"user_picker","required":false},
      {"name":"pc_takeout","label":"PCの持ち出し","label_en":"Taking Company PC","type":"select","required":true,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}]},
      {"name":"has_accommodation","label":"宿泊の有無","label_en":"Accommodation Required","type":"select","required":true,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}]},
      {"name":"has_backpay","label":"パッケージ料金利用","label_en":"Using Packaged Fare","type":"select","required":false,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}],"conditional_on":{"field":"has_accommodation","equals":"yes"}},
      {"name":"backpay_estimate","label":"パッケージ料金概算（円）","label_en":"Estimated Packaged Fare","type":"number","required":false,"unit":"円","validation":{"min":0},"conditional_on":{"field":"has_backpay","equals":"yes"}},
      {"name":"accommodations","label":"宿泊情報","label_en":"Accommodation Details","type":"repeat_group","required":false,"min_rows":0,"add_label":"宿泊先を追加","add_label_en":"Add Accommodation","conditional_on":{"field":"has_accommodation","equals":"yes"},"fields":[
        {"name":"accommodation_name","label":"宿泊施設名","label_en":"Hotel / Facility","type":"text","required":false},
        {"name":"check_in_date","label":"チェックイン","label_en":"Check-in","type":"date","required":false},
        {"name":"check_out_date","label":"チェックアウト","label_en":"Check-out","type":"date","required":false,"validation":{"date_after_or_equal":"check_in_date"}},
        {"name":"nights","label":"泊数","label_en":"Nights","type":"number","unit":"泊","validation":{"min":0,"validate_nights_from":{"check_in":"check_in_date","check_out":"check_out_date"}}},
        {"name":"fee_estimate","label":"概算費用（円）","label_en":"Estimated Fee","type":"number","unit":"円","validation":{"min":0},"sum_target":"accommodation_fee_estimate"}
      ]},
      {"name":"accommodation_fee_estimate","label":"宿泊費概算合計（円）","label_en":"Total Estimated Accommodation","type":"number","computed":true,"unit":"円","conditional_on":{"field":"has_accommodation","equals":"yes"}},
      {"name":"transport_mode","label":"交通手段","label_en":"Transportation Means","type":"checkbox","required":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"car","label_ja":"営業車"},{"value":"rental","label_ja":"レンタルカー"}]},
      {"name":"departure_location","label":"出発地","label_en":"Departure Place","type":"text","required":true},
      {"name":"arrival_location","label":"目的地","label_en":"Destination Place","type":"text","required":true},
      {"name":"has_expressway","label":"高速・ETCカードの有無","label_en":"Possession of Highway/ETC Card","type":"select","required":false,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}],"conditional_on":{"field":"transport_mode","equals":["car","rental"]}},
      {"name":"driving_section","label":"走行区間","label_en":"Driving Section","type":"text","required":false,"placeholder":"例）自宅 → 大阪営業所","conditional_on":{"field":"has_expressway","equals":"yes"}},
      {"name":"mileage","label":"走行距離（km）","label_en":"Mileage","type":"number","required":false,"unit":"km","validation":{"min":0},"conditional_on":{"field":"has_expressway","equals":"yes"}},
      {"name":"routes","label":"交通費明細","label_en":"Route Table","type":"route_entry","required":false,"show_mode":true,"show_date":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"other","label_ja":"その他"}],"conditional_on":{"field":"transport_mode","equals":["shinkansen","airplane","train","bus","taxi"]}},
      {"name":"transport_total","label":"交通費合計（円）","label_en":"Total Transportation","type":"number","computed":true,"sum_target":"routes","sum_field":"fare","unit":"円"},
      {"name":"expected_amount","label":"申請合計（円）","label_en":"Total Application Amount","type":"number","computed":true,"formula":"transport_total+accommodation_fee_estimate+backpay_estimate","unit":"円","show_in_row":true,"amount_field":true,"row_compare_with":"settlement_total"}
    ]
  }'::jsonb,

  settlement_schema = '{
    "fields": [
      {"name":"settlement_date","label":"精算申請日","label_en":"Settlement Application Date","type":"date","required":true,"default_value":"__today__"},
      {"name":"destination","label":"出張先","label_en":"Destination","type":"text","required":true},
      {"name":"purpose","label":"出張目的","label_en":"Purpose","type":"textarea","required":false},
      {"name":"departure_date","label":"出発日","label_en":"Departure Date","type":"date","required":true},
      {"name":"return_date","label":"帰着日","label_en":"Return Date","type":"date","required":true,"validation":{"date_after_or_equal":"departure_date"}},
      {"name":"trip_duration","label":"出張日数","label_en":"Trip Duration","type":"number","computed":true,"date_diff_from":"departure_date","date_diff_to":"return_date","unit":"日","helper_text":"日当明細の合計日数がこの日数と一致しているか確認してください"},
      {"name":"companions","label":"同行者","label_en":"Accompanying Persons","type":"user_picker","required":false},
      {"name":"backpay_amount","label":"パッケージ料金（円）","label_en":"Packaged Fare","type":"number","required":false,"unit":"円","validation":{"min":0}},
      {"name":"accommodations","label":"宿泊費明細","label_en":"Accommodation Details","type":"repeat_group","required":false,"min_rows":0,"add_label":"宿泊先を追加","add_label_en":"Add Accommodation","fields":[
        {"name":"accommodation_name","label":"宿泊施設名","label_en":"Hotel / Facility","type":"text","required":false},
        {"name":"check_in_date","label":"チェックイン","label_en":"Check-in","type":"date","required":false},
        {"name":"check_out_date","label":"チェックアウト","label_en":"Check-out","type":"date","required":false,"validation":{"date_after_or_equal":"check_in_date"}},
        {"name":"nights","label":"泊数","label_en":"Nights","type":"number","unit":"泊","validation":{"min":0,"validate_nights_from":{"check_in":"check_in_date","check_out":"check_out_date"}}},
        {"name":"amount","label":"金額（円）","label_en":"Amount","type":"number","unit":"円","validation":{"min":0},"sum_target":"accommodation_total"}
      ]},
      {"name":"accommodation_total","label":"宿泊費合計（円）","label_en":"Total Accommodation","type":"number","computed":true,"unit":"円"},
      {"name":"transport_mode","label":"実際の交通手段","label_en":"Actual Transport Modes","type":"checkbox","required":false,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"car","label_ja":"営業車"},{"value":"rental","label_ja":"レンタルカー"}]},
      {"name":"expressway_toll","label":"高速料金立替（円）","label_en":"Highway Toll","type":"number","required":false,"unit":"円","validation":{"min":0},"conditional_on":{"field":"transport_mode","equals":["car","rental"]}},
      {"name":"routes","label":"実費交通費明細","label_en":"Actual Route Table","type":"route_entry","required":false,"show_mode":true,"show_date":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"car","label_ja":"営業車"},{"value":"rental","label_ja":"レンタルカー"},{"value":"other","label_ja":"その他"}],"conditional_on":{"field":"transport_mode","equals":["shinkansen","airplane","train","bus","taxi","car","rental"]}},
      {"name":"transport_total","label":"交通費合計（円）","label_en":"Total Transportation","type":"number","computed":true,"sum_target":"routes","sum_field":"fare","unit":"円"},
      {"name":"daily_allowances","label":"日当明細","label_en":"Per Diem Entries","type":"repeat_group","required":false,"min_rows":0,"add_label":"日を追加","add_label_en":"Add Day","helper_text":"出発日〜帰着日の各日を追加し日当区分を選択してください","unique_rows_by":"travel_date","fields":[
        {"name":"travel_date","label":"日付","label_en":"Date","type":"date","required":false,"validation":{"date_after_or_equal":"departure_date","date_before_or_equal":"return_date"}},
        {"name":"day_type","label":"日当区分","label_en":"Allowance","type":"select","required":false,"options":[{"value":"0","label_ja":"0（なし）","label_en":"0 (none)"},{"value":"0.5","label_ja":"0.5（半日）","label_en":"0.5 (half)"},{"value":"1","label_ja":"1（全日）","label_en":"1 (full)"}],"sum_target":"daily_allowance_days_total"}
      ]},
      {"name":"daily_allowance_days_total","label":"日当合計日数","label_en":"Total Per Diem Days","type":"number","computed":true,"unit":"日","validation":{"max_from_field":"trip_duration"}},
      {"name":"_daily_rate","label":"日当単価（管理者設定・役職別）","label_en":"Daily Rate (Admin / Role-based)","type":"number","computed":true,"unit":"円","helper_text":"管理者の日当レートページで設定された役職別単価が自動適用されます"},
      {"name":"daily_allowance_total","label":"日当合計（円）","label_en":"Total Per Diem","type":"number","computed":true,"formula":"daily_allowance_days_total*_daily_rate","unit":"円"},
      {"name":"other_expenses_list","label":"その他費用明細","label_en":"Other Expenses","type":"repeat_group","required":false,"min_rows":0,"add_label":"費用を追加","add_label_en":"Add Expense","fields":[
        {"name":"description","label":"内容","label_en":"Description","type":"text","required":true},
        {"name":"amount","label":"金額（円）","label_en":"Amount","type":"number","unit":"円","validation":{"min":0},"sum_target":"other_expenses_total"}
      ]},
      {"name":"other_expenses_total","label":"その他費用合計（円）","label_en":"Total Other Expenses","type":"number","computed":true,"unit":"円"},
      {"name":"receipts","label":"領収書","label_en":"Receipts","type":"repeat_group","required":false,"min_rows":0,"add_label":"領収書を追加","add_label_en":"Add Receipt","fields":[
        {"name":"receipt_file","label":"領収書ファイル","label_en":"Receipt File","type":"ai_file_reader","required":false,"file_category":"receipts","target_amount_field":"receipt_amount"},
        {"name":"receipt_description","label":"内容","label_en":"Description","type":"text","required":true},
        {"name":"receipt_amount","label":"金額（円）","label_en":"Amount","type":"number","required":true,"unit":"円","validation":{"min":0},"sum_target":"receipt_total"}
      ]},
      {"name":"receipt_total","label":"領収書合計","label_en":"Receipt Total","type":"number","computed":true,"unit":"円"},
      {"name":"remarks","label":"備考","label_en":"Remarks","type":"textarea","required":false},
      {"name":"settlement_total","label":"精算合計（円）","label_en":"Grand Total","type":"number","computed":true,"formula":"backpay_amount+transport_total+accommodation_total+daily_allowance_total+expressway_toll+other_expenses_total","unit":"円","show_in_row":true,"amount_field":true}
    ]
  }'::jsonb

WHERE code = 'BUSINESS_TRIP';

-- Sync active version snapshot
UPDATE form_template_versions ftv
SET
  schema_definition = ft.schema_definition,
  settlement_schema = ft.settlement_schema
FROM form_templates ft
WHERE ftv.template_id = ft.id
  AND ft.code         = 'BUSINESS_TRIP'
  AND ftv.is_active   = TRUE;
