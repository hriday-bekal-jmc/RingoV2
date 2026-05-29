-- ==========================================
-- 002: Seed Business Trip (Pattern 3) & Routes
-- ==========================================

-- 1. Ensure Pattern 3 exists
INSERT INTO workflow_patterns (id, code, name, description)
VALUES (3, 'PATTERN_3', '稟議＋精算 (Approval + Settlement)', 'Ringi approval followed by receipt upload and accounting settlement.')
ON CONFLICT (code) DO NOTHING;

-- 2. Insert the Business Trip Template (出張伺い・精算)
INSERT INTO form_templates (id, pattern_id, code, title, title_ja, schema_definition, settlement_schema)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
    3, 
    'BUSINESS_TRIP', 
    'Business Trip Request & Settlement', 
    '出張伺い・精算', 
    -- Ringi Schema (Before trip)
    '{
      "fields": [
        {"name":"application_date","label":"申請日","label_en":"Application Date","type":"date","required":true,"default_value":"__today__"},
        {"name":"subject","label":"件名","label_en":"Subject","type":"text","required":true,"placeholder":"例）大阪出張 2025年6月","show_in_row":true},
        {"name":"destination","label":"出張先","label_en":"Destination","type":"text","required":true,"show_in_row":true},
        {"name":"purpose","label":"出張目的","label_en":"Purpose","type":"textarea","required":true},
        {"name":"departure_date","label":"出発日","label_en":"Departure Date","type":"date","required":true},
        {"name":"return_date","label":"帰着日","label_en":"Return Date","type":"date","required":true},
        {"name":"companions","label":"同行者","label_en":"Accompanying Persons","type":"user_picker","required":false},
        {"name":"pc_takeout","label":"PCの持ち出し","label_en":"Taking Company PC","type":"select","required":true,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}]},
        {"name":"has_accommodation","label":"宿泊の有無","label_en":"Accommodation Required","type":"select","required":true,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}]},
        {"name":"has_backpay","label":"パッケージ料金利用","label_en":"Using Packaged Fare","type":"select","required":false,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}],"conditional_on":{"field":"has_accommodation","equals":"yes"}},
        {"name":"backpay_estimate","label":"パッケージ料金概算（円）","label_en":"Estimated Packaged Fare","type":"number","required":false,"unit":"円","validation":{"min":0},"conditional_on":{"field":"has_backpay","equals":"yes"}},
        {"name":"accommodation_name","label":"宿泊施設名","label_en":"Accommodation Name","type":"text","required":false,"conditional_on":{"field":"has_accommodation","equals":"yes"}},
        {"name":"nights","label":"泊数","label_en":"Number of Nights","type":"number","required":false,"unit":"泊","validation":{"min":0},"conditional_on":{"field":"has_accommodation","equals":"yes"}},
        {"name":"accommodation_fee_estimate","label":"宿泊費概算（円）","label_en":"Estimated Accommodation Fee","type":"number","required":false,"unit":"円","validation":{"min":0},"conditional_on":{"field":"has_accommodation","equals":"yes"}},
        {"name":"transport_mode","label":"交通手段","label_en":"Transportation Means","type":"checkbox","required":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"car","label_ja":"営業車"},{"value":"rental","label_ja":"レンタルカー"}]},
        {"name":"departure_location","label":"出発地","label_en":"Departure Place","type":"text","required":true},
        {"name":"arrival_location","label":"目的地","label_en":"Destination Place","type":"text","required":true},
        {"name":"has_expressway","label":"高速・ETCカードの有無","label_en":"Possession of Highway/ETC Card","type":"select","required":false,"options":[{"value":"yes","label_ja":"あり"},{"value":"no","label_ja":"なし"}],"conditional_on":{"field":"transport_mode","equals":["car","rental"]}},
        {"name":"driving_section","label":"走行区間","label_en":"Driving Section","type":"text","required":false,"placeholder":"例）自宅 → 大阪営業所","conditional_on":{"field":"has_expressway","equals":"yes"}},
        {"name":"mileage","label":"走行距離（km）","label_en":"Mileage","type":"number","required":false,"unit":"km","validation":{"min":0},"conditional_on":{"field":"has_expressway","equals":"yes"}},
        {"name":"routes","label":"交通費明細","label_en":"Train / Bus Route Table","type":"route_entry","required":false,"show_mode":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"other","label_ja":"その他"}],"conditional_on":{"field":"transport_mode","equals":["shinkansen","airplane","train","bus","taxi"]}},
        {"name":"transport_total","label":"交通費合計（円）","label_en":"Total Transportation Expenses","type":"number","computed":true,"sum_target":"routes","sum_field":"fare","unit":"円"},
        {"name":"expected_amount","label":"申請合計（円）","label_en":"Total Application Amount","type":"number","computed":true,"formula":"transport_total+accommodation_fee_estimate+backpay_estimate","unit":"円","show_in_row":true,"amount_field":true}
      ]
    }'::jsonb,
    -- Settlement Schema (After trip)
    '{
      "fields": [
        {"name":"settlement_date","label":"精算申請日","label_en":"Settlement Application Date","type":"date","required":true,"default_value":"__today__"},
        {"name":"destination","label":"出張先","label_en":"Destination","type":"text","required":true},
        {"name":"purpose","label":"出張目的","label_en":"Purpose","type":"textarea","required":false},
        {"name":"departure_date","label":"出発日","label_en":"Departure Date","type":"date","required":true},
        {"name":"return_date","label":"帰着日","label_en":"Return Date","type":"date","required":true},
        {"name":"companions","label":"同行者","label_en":"Accompanying Persons","type":"user_picker","required":false},
        {"name":"backpay_amount","label":"パッケージ料金（円）","label_en":"Packaged Fare","type":"number","required":false,"unit":"円","validation":{"min":0}},
        {"name":"accommodation_fee","label":"宿泊費合計（円）","label_en":"Total Accommodation Fee","type":"number","required":false,"unit":"円","validation":{"min":0}},
        {"name":"expressway_toll","label":"高速料金立替（円）","label_en":"Highway Toll Advance Payment","type":"number","required":false,"unit":"円","validation":{"min":0}},
        {"name":"routes","label":"実費交通費明細","label_en":"Actual Route Table","type":"route_entry","required":false,"show_mode":true,"options":[{"value":"shinkansen","label_ja":"新幹線"},{"value":"airplane","label_ja":"飛行機"},{"value":"train","label_ja":"在来線・地下鉄"},{"value":"bus","label_ja":"バス"},{"value":"taxi","label_ja":"タクシー"},{"value":"car","label_ja":"営業車"},{"value":"rental","label_ja":"レンタルカー"},{"value":"other","label_ja":"その他"}]},
        {"name":"transport_total","label":"交通費合計（円）","label_en":"Total Transportation","type":"number","computed":true,"sum_target":"routes","sum_field":"fare","unit":"円"},
        {"name":"daily_allowance_days","label":"日当支給日数","label_en":"Per Diem Days","type":"select","required":false,"options":[{"value":"0","label_ja":"0日"},{"value":"0.5","label_ja":"0.5日"},{"value":"1","label_ja":"1日"}]},
        {"name":"daily_allowance_total","label":"日当合計（円）","label_en":"Total Per Diem","type":"number","computed":true,"formula":"daily_allowance_days*3000","unit":"円"},
        {"name":"other_expenses","label":"その他費用（円）","label_en":"Other Expenses","type":"number","required":false,"unit":"円","validation":{"min":0}},
        {"name":"receipts","label":"領収書","label_en":"Receipts","type":"repeat_group","required":false,"min_rows":0,"add_label":"領収書を追加","add_label_en":"Add Receipt","fields":[
          {"name":"receipt_file","label":"領収書ファイル","label_en":"Receipt File","type":"ai_file_reader","required":false,"file_category":"receipts","target_amount_field":"receipt_amount"},
          {"name":"receipt_description","label":"内容","label_en":"Description","type":"text","required":true},
          {"name":"receipt_amount","label":"金額（円）","label_en":"Amount","type":"number","required":true,"unit":"円","validation":{"min":0},"sum_target":"receipt_total"}
        ]},
        {"name":"receipt_total","label":"領収書合計","label_en":"Receipt Total","type":"number","computed":true,"unit":"円"},
        {"name":"remarks","label":"備考","label_en":"Remarks","type":"textarea","required":false},
        {"name":"settlement_total","label":"精算合計（円）","label_en":"Grand Total","type":"number","computed":true,"formula":"backpay_amount+transport_total+accommodation_fee+daily_allowance_total+expressway_toll+other_expenses","unit":"円","show_in_row":true,"amount_field":true},
        {"name":"transfer_date","label":"振込予定日","label_en":"Scheduled Transfer Date","type":"date","required":false}
      ]
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- 3. Create a Dummy Department to attach the default route to
INSERT INTO departments (id, name, code)
VALUES ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380d22', '営業部 (Sales)', 'SALES')
ON CONFLICT DO NOTHING;

-- 4. Define the Predetermined Route for this Template & Dept
INSERT INTO approval_routes (id, template_id, department_id, name, stage, is_default)
VALUES (
    'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380d22',
    '出張基本ルート (Business Trip Default Route)',
    'RINGI',
    true
) ON CONFLICT DO NOTHING;

-- 5. Route steps
INSERT INTO approval_route_steps (route_id, step_order, label, approver_role) VALUES
('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 1, '承認者1 (Approver 1)', 'MANAGER'),
('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 2, '承認者2 (Approver 2)', 'GM')
ON CONFLICT DO NOTHING;

-- Settlement Stage
INSERT INTO approval_routes (id, template_id, department_id, name, stage, is_default)
VALUES (
    'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380d22',
    '出張精算ルート (Settlement Default Route)',
    'SETTLEMENT',
    true
) ON CONFLICT DO NOTHING;

INSERT INTO approval_route_steps (route_id, step_order, label, approver_role, action_type) VALUES
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 1, '承認者1 (Approver 1)', 'MANAGER', 'APPROVE'),
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 2, '承認者2 / 部門承認 (Dept Approval)', 'DEPT_HEAD', 'APPROVE'),
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 3, '総務承認 (Soumu Approval)', 'SOUMU', 'APPROVE'),
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 4, '専務→社長 (President Confirm)', 'PRESIDENT', 'CONFIRM'),
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 5, '総務精算処理 (Accounting Final)', 'ACCOUNTING', 'APPROVE')
ON CONFLICT DO NOTHING;