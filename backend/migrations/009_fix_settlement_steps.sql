-- Migration 009: Patch missing role-based settlement approval_steps
-- Bug: start-settlement only selected approver_id, ignoring approver_role.
-- Result: steps where approver_id=NULL (role-based) were inserted with NULL approver_id,
-- which either violated NOT NULL or was silently dropped.
-- Fix: for each PENDING_SETTLEMENT app, find route steps with no matching approval_step
-- and insert them with the resolved user.

DO $$
DECLARE
  app_rec  RECORD;
  route_id UUID;
  step_rec RECORD;
  resolved_uid UUID;
BEGIN
  FOR app_rec IN
    SELECT a.id AS app_id, a.template_id, u.department_id
    FROM applications a
    JOIN users u ON u.id = a.applicant_id
    WHERE a.status = 'PENDING_SETTLEMENT'
  LOOP
    -- Find settlement route
    SELECT ar.id INTO route_id
    FROM approval_routes ar
    WHERE ar.template_id = app_rec.template_id
      AND ar.department_id = app_rec.department_id
      AND ar.stage = 'SETTLEMENT'
      AND ar.is_active = TRUE
      AND ar.is_default = TRUE
    LIMIT 1;

    IF route_id IS NULL THEN
      RAISE NOTICE 'app %: no settlement route, skip', app_rec.app_id;
      CONTINUE;
    END IF;

    -- Insert missing steps (route steps whose step_order has no approval_step)
    FOR step_rec IN
      SELECT rs.step_order, rs.approver_id, rs.approver_role, rs.label, rs.action_type
      FROM approval_route_steps rs
      WHERE rs.route_id = route_id
        AND NOT EXISTS (
          SELECT 1 FROM approval_steps ast
          WHERE ast.application_id = app_rec.app_id
            AND ast.stage = 'SETTLEMENT'
            AND ast.step_order = rs.step_order
        )
      ORDER BY rs.step_order ASC
    LOOP
      resolved_uid := step_rec.approver_id;

      IF resolved_uid IS NULL AND step_rec.approver_role IS NOT NULL THEN
        SELECT id INTO resolved_uid
        FROM users
        WHERE role = step_rec.approver_role AND is_active = TRUE
        ORDER BY created_at ASC LIMIT 1;
      END IF;

      IF resolved_uid IS NULL THEN
        RAISE NOTICE 'app % step %: cannot resolve approver, skip', app_rec.app_id, step_rec.step_order;
        CONTINUE;
      END IF;

      INSERT INTO approval_steps
        (application_id, step_order, stage, approver_id, label, action_type, status)
      VALUES
        (app_rec.app_id, step_rec.step_order, 'SETTLEMENT',
         resolved_uid, step_rec.label, step_rec.action_type, 'WAITING');

      RAISE NOTICE 'app %: inserted missing step % (%) for user %',
        app_rec.app_id, step_rec.step_order, step_rec.label, resolved_uid;
    END LOOP;
  END LOOP;
END $$;
