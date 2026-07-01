-- Add ROLE_IN / ROLE_NOT_IN condition types.
-- condition_value stores comma-separated role codes (e.g. 'MEMBER,SUB_MANAGER_TSUKI').
-- Evaluates against the applicant's role at chain-resolve time.

ALTER TABLE approval_conditions DROP CONSTRAINT IF EXISTS approval_conditions_condition_type_check;
ALTER TABLE approval_conditions ADD CONSTRAINT approval_conditions_condition_type_check
  CHECK (condition_type IN ('AMOUNT_LT','AMOUNT_GTE','DEPT_IN','DEPT_NOT_IN','ROLE_IN','ROLE_NOT_IN'));
