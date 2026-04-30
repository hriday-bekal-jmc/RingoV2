-- ==========================================
-- RINGO — Initial Schema (Migration 001)
-- ==========================================
-- Predetermined approval routes (admin-configured) instead of user-picked approvers.
-- Two-stage workflow: Ringi (approval) → Settlement (post-approval expense)
-- Optimistic locking via version column. JSONB + GIN for dynamic forms.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram search for approver picker

-- ==========================================
-- 1. ORGANIZATION
-- ==========================================
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(50) NOT NULL UNIQUE,
    parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_departments_parent ON departments(parent_id);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
        -- EMPLOYEE | MANAGER | GM | DEPT_HEAD | SOUMU | SENMU | PRESIDENT | ACCOUNTING | ADMIN
    google_oauth_sub VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    reports_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_name_trgm ON users USING GIN (full_name gin_trgm_ops);

-- ==========================================
-- 2. DELEGATION ENGINE (vacation proxies)
-- ==========================================
CREATE TABLE delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delegatee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
);
CREATE INDEX idx_delegations_active ON delegations(delegator_id, is_active, start_date, end_date);

-- ==========================================
-- 3. WORKFLOW PATTERNS + TEMPLATES
-- ==========================================
CREATE TABLE workflow_patterns (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,  -- PATTERN_1, PATTERN_2, PATTERN_3
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id INT NOT NULL REFERENCES workflow_patterns(id),
    code VARCHAR(50) NOT NULL UNIQUE,  -- e.g. BUSINESS_TRIP, PC_TAKEOUT
    title VARCHAR(255) NOT NULL,
    title_ja VARCHAR(255),
    schema_definition JSONB NOT NULL,  -- field definitions for dynamic form renderer
    settlement_schema JSONB,           -- only for Pattern 2/3
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_templates_active ON form_templates(is_active);
CREATE INDEX idx_templates_schema ON form_templates USING GIN (schema_definition);

-- Scope matrix: which dept can use which template, at which requirement level
CREATE TABLE template_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    requirement_level VARCHAR(10) NOT NULL,  -- MUST | SHOULD | COULD | WONT
    specific_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        -- e.g. only Mai-san can use 備品購入 in 健保
    UNIQUE (template_id, department_id, specific_user_id)
);
CREATE INDEX idx_template_perm_dept ON template_permissions(department_id, template_id);

-- ==========================================
-- 4. APPROVAL ROUTES (predetermined, admin-managed)
-- ==========================================
-- Defines a named route applicable to (template_id, department_id).
-- Each route has ordered steps. System picks the matching route at submit time.
CREATE TABLE approval_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'RINGI',  -- RINGI | SETTLEMENT
    is_default BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, department_id, stage, name)
);
CREATE INDEX idx_routes_lookup ON approval_routes(template_id, department_id, stage, is_active);

CREATE TABLE approval_route_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES approval_routes(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
        -- explicit user OR (role + department) below if approver_id is null
    approver_role VARCHAR(50),       -- fallback: any user with this role
    approver_dept_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    label VARCHAR(255),              -- "承認者1", "総務承認", "専務 → 社長", etc.
    action_type VARCHAR(20) DEFAULT 'APPROVE',  -- APPROVE | CONFIRM (for 確認 step)
    UNIQUE (route_id, step_order),
    CHECK (approver_id IS NOT NULL OR approver_role IS NOT NULL)
);
CREATE INDEX idx_route_steps_route ON approval_route_steps(route_id, step_order);

-- ==========================================
-- 5. APPLICATIONS (Ringi)
-- ==========================================
CREATE SEQUENCE application_number_seq START 1;

CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_number VARCHAR(50) UNIQUE,  -- e.g. RNG-2026-000001 (assigned post-final-approval)
    applicant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
    route_id UUID REFERENCES approval_routes(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
        -- DRAFT | PENDING_APPROVAL | APPROVED | REJECTED | RETURNED
        -- | PENDING_SETTLEMENT | SETTLEMENT_APPROVED | COMPLETED | CANCELLED
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_apps_applicant_status ON applications(applicant_id, status);
CREATE INDEX idx_apps_status ON applications(status);
CREATE INDEX idx_apps_form_data ON applications USING GIN (form_data);

-- ==========================================
-- 6. APPROVAL STEPS (state machine, per-application)
-- ==========================================
CREATE TABLE approval_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'RINGI',  -- RINGI | SETTLEMENT
    approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        -- resolved at submit-time (after delegation lookup)
    original_approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
        -- if delegation kicked in, who was the original
    label VARCHAR(255),
    action_type VARCHAR(20) DEFAULT 'APPROVE',  -- APPROVE | CONFIRM
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        -- PENDING | APPROVED | REJECTED | RETURNED | SKIPPED
    comment TEXT,
    acted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_steps_app ON approval_steps(application_id, stage, step_order);
CREATE INDEX idx_steps_approver ON approval_steps(approver_id, status);

-- ==========================================
-- 7. SETTLEMENTS (Pattern 2 & 3) — expected vs actual
-- ==========================================
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    expected_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    actual_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'JPY',
    settlement_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_VERIFICATION',
        -- PENDING_VERIFICATION | VERIFIED | DISPUTED | PROCESSED
    transfer_date DATE,
    processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_settlements_status ON settlements(status);

-- ==========================================
-- 8. RECEIPTS (1-to-many per settlement; tax compliance)
-- ==========================================
CREATE SEQUENCE receipt_number_seq START 1;

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) UNIQUE NOT NULL
        DEFAULT 'RCPT-' || LPAD(nextval('receipt_number_seq')::TEXT, 6, '0'),
    receipt_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    vendor_name VARCHAR(255),
    category VARCHAR(100),  -- 交通費, 宿泊費, 食事, etc.
    drive_file_id VARCHAR(255) NOT NULL,
    drive_file_url TEXT,
    extracted_data JSONB,   -- OCR/AI extraction results
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_receipts_settlement ON receipts(settlement_id);

-- ==========================================
-- 9. AUDIT LOGS (permanent, append-only)
-- ==========================================
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
        -- APPLICATION_SUBMIT, APPROVAL_APPROVE, APPROVAL_REJECT, SETTLEMENT_PROCESS, etc.
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);

-- ==========================================
-- TRIGGERS — auto-update updated_at columns
-- ==========================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON form_templates
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_routes_updated BEFORE UPDATE ON approval_routes
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_apps_updated BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_settlements_updated BEFORE UPDATE ON settlements
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
