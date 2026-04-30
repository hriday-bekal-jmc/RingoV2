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
            {"name": "destination", "label": "出張先 (Destination)", "type": "text", "required": true},
            {"name": "purpose", "label": "目的 (Purpose)", "type": "textarea", "required": true},
            {"name": "start_date", "label": "開始日 (Start Date)", "type": "date", "required": true},
            {"name": "end_date", "label": "終了日 (End Date)", "type": "date", "required": true},
            {"name": "expected_amount", "label": "概算費用 (Expected Cost - JPY)", "type": "number", "required": true}
        ]
    }'::jsonb,
    -- Settlement Schema (After trip)
    '{
        "fields": [
            {"name": "actual_amount", "label": "実費合計 (Actual Cost - JPY)", "type": "number", "required": true},
            {"name": "receipts", "label": "領収書 (Receipts)", "type": "file", "required": true, "multiple": true}
        ]
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- 3. Create a Dummy Department to attach the default route to
INSERT INTO departments (id, name, code)
VALUES ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380d22', '営業部 (Sales)', 'SALES')
ON CONFLICT (code) DO NOTHING;

-- 4. Define the Predetermined Route for this Template & Dept (修正済)
INSERT INTO approval_routes (id, template_id, department_id, name, stage, is_default)
VALUES (
    'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
    'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380d22', 
    '出張基本ルート (Business Trip Default Route)', 
    'RINGI', 
    true
) ON CONFLICT DO NOTHING;

-- 5. Insert the EXACT steps from your flowchart image (修正済)
-- Ringi Stage (稟議と申請)
INSERT INTO approval_route_steps (route_id, step_order, label, approver_role) VALUES
('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 1, '承認者1 (Approver 1)', 'MANAGER'),
('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 2, '承認者2 (Approver 2)', 'GM');


-- Settlement Stage (精算書作成以降) (修正済)
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
('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c44', 5, '総務精算処理 (Accounting Final)', 'ACCOUNTING', 'APPROVE');