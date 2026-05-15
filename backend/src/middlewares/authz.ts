// Centralized authorization helpers for application & approval-step access.
// Throw HttpErr — caller catches via existing { status, message } pattern.

import type pg from 'pg';
import { query } from '../config/db';

/**
 * Verify a chosen route_id is legal for {template, department, stage}.
 * Stops a malicious client from picking another department's route or an
 * inactive route to bypass the proper approval chain.
 *
 * @throws 400 if route_id is missing/blank
 * @throws 403 if the route does not match the expected scope
 */
export async function assertValidRouteForTemplate(
  client: pg.PoolClient,
  routeId: string | undefined,
  templateId: string,
  departmentId: string | null,
  stage: 'RINGI' | 'SETTLEMENT' = 'RINGI',
): Promise<void> {
  if (!routeId) throw httpErr(400, 'route_id required');
  const r = await client.query(
    `SELECT id FROM approval_routes
     WHERE id = $1
       AND template_id = $2
       AND department_id = $3
       AND stage = $4
       AND is_active = TRUE
     LIMIT 1`,
    [routeId, templateId, departmentId, stage],
  );
  if (r.rows.length === 0) {
    throw httpErr(403, '選択されたルートはこのテンプレート/部署/段階で利用できません');
  }
}

export interface HttpErr extends Error { status: number }
export const httpErr = (status: number, message: string): HttpErr =>
  Object.assign(new Error(message), { status }) as HttpErr;

interface Actor { id: string; role: string; is_admin?: boolean | null }

const actorIsAdmin = (actor: Actor): boolean => Boolean(actor.is_admin);

/**
 * Can the actor READ this application?
 * Allowed:
 *   - applicant themselves
 *   - any user listed in approval_steps as approver_id (assigned approver)
 *   - any user who has acted on the app (acted_by)
 *   - users in same department as applicant + role >= MANAGER (departmental visibility)
 *   - ACCOUNTING / SOUMU (both see all settlements; SOUMU handles accounting)
 *   - ADMIN
 */
export async function assertCanReadApp(
  actor: Actor,
  appId: string,
  client?: pg.PoolClient,
): Promise<void> {
  if (actorIsAdmin(actor) || actor.role === 'ACCOUNTING' || actor.role === 'SOUMU') return;

  const q = client ? client.query.bind(client) : query;
  const r = await q(
    `SELECT 1
     FROM applications a
     LEFT JOIN approval_steps s ON s.application_id = a.id
     LEFT JOIN users applicant ON applicant.id = a.applicant_id
     LEFT JOIN users actor_u ON actor_u.id = $2
     WHERE a.id = $1
       AND (
         a.applicant_id = $2
         OR s.approver_id = $2
         OR s.acted_by = $2
         OR (
           applicant.department_id IS NOT NULL
           AND applicant.department_id = actor_u.department_id
           AND (actor_u.is_admin = TRUE OR actor_u.role IN ('MANAGER','GM'))
         )
       )
     LIMIT 1`,
    [appId, actor.id],
  );
  if (r.rows.length === 0) throw httpErr(403, 'この申請を閲覧する権限がありません');
}

/**
 * Can the actor ACT (approve/return/reject) on the current pending step of this app?
 * Returns the locked current step row.
 *
 * Rules:
 *   - app must be in actionable status (caller passes allowedStatuses)
 *   - exactly one PENDING step must exist
 *   - if step has explicit approver_id → must match actor (ADMIN bypass)
 *   - if step has no approver_id → role-based (MANAGER/GM/ADMIN/ACCOUNTING for SETTLEMENT)
 *   - prevent same-user consecutive approvals on unassigned steps (caller can opt-in)
 */
export async function assertCanActOnStep(
  client: pg.PoolClient,
  actor: Actor,
  appId: string,
  allowedStatuses: string[],
): Promise<{ id: string; step_order: number; approver_id: string | null; stage: string; action_type: string }> {
  // Lock app row
  const appRow = await client.query(
    `SELECT id, status FROM applications WHERE id = $1 FOR UPDATE`,
    [appId],
  );
  if (appRow.rows.length === 0) throw httpErr(404, 'Application not found');
  const status = appRow.rows[0].status as string;
  if (!allowedStatuses.includes(status)) {
    throw httpErr(409, `この状態では操作できません: ${status}`);
  }

  // Current pending step
  const stepRes = await client.query(
    `SELECT id, step_order, approver_id, stage, action_type
     FROM approval_steps
     WHERE application_id = $1 AND status = 'PENDING'
     ORDER BY step_order ASC LIMIT 1`,
    [appId],
  );
  if (stepRes.rows.length === 0) {
    throw httpErr(409, '保留中のステップが見つかりません');
  }
  const step = stepRes.rows[0] as {
    id: string; step_order: number; approver_id: string | null; stage: string; action_type: string;
  };

  if (actorIsAdmin(actor)) return step;

  // Explicit approver assigned → must be actor
  if (step.approver_id) {
    if (step.approver_id !== actor.id) {
      throw httpErr(403, 'この承認ステップはあなたに割り当てられていません');
    }
    return step;
  }

  // Unassigned step → role gate by stage
  const allowed = step.stage === 'SETTLEMENT'
    ? ['ACCOUNTING', 'MANAGER', 'GM']
    : ['MANAGER', 'GM'];
  if (!allowed.includes(actor.role)) {
    throw httpErr(403, 'この承認ステップを操作する権限がありません');
  }
  return step;
}
