// Shared helper for resolving approval route steps into concrete user IDs.
//
// approval_route_steps stores either:
//   - approver_id  (specific user)  — pre-resolved
//   - approver_role (e.g. "MANAGER") — needs lookup at submit/resubmit time
//
// Old code did the lookup in a per-step loop:  N steps = N queries (N+1).
// This helper does it in ONE batched query for all roles in the route.
//
// Used by applicationRoutes (submit, resubmit, settle, settle-resubmit).

import type pg from 'pg';

export interface ResolvedStep {
  step_order:  number;
  approver_id: string;
  label:       string;
  action_type: string;
}

interface RawStep {
  step_order:    number;
  approver_id:   string | null;
  approver_role: string | null;
  label:         string;
  action_type:   string;
}

/**
 * Resolve role-based steps in a route to concrete users in one DB round-trip.
 *
 * Throws (with status: 422) if:
 *   - The route has no steps
 *   - A step has neither approver_id nor approver_role
 *   - A step's role has no active user
 *
 * @param errorPrefix Optional prefix for error messages, e.g. "精算ルート"
 *                    Used to disambiguate RINGI vs SETTLEMENT errors.
 */
export async function resolveApprovalSteps(
  client:      pg.PoolClient,
  routeId:     string,
  errorPrefix: string = '',
): Promise<ResolvedStep[]> {
  const stepsRes = await client.query(
    `SELECT step_order, approver_id, approver_role, label, action_type
     FROM approval_route_steps
     WHERE route_id = $1
     ORDER BY step_order ASC`,
    [routeId],
  );

  const raws = stepsRes.rows as RawStep[];
  if (raws.length === 0) {
    throw Object.assign(
      new Error(`${errorPrefix ? errorPrefix + 'の' : ''}ルートにステップがありません`),
      { status: 422 },
    );
  }

  // Collect distinct roles needing lookup
  const roleSet = new Set<string>();
  for (const r of raws) {
    if (!r.approver_id && r.approver_role) roleSet.add(r.approver_role);
  }

  // Single batched lookup. Order by role + created_at so we deterministically
  // pick the *first* active user per role (same behaviour as the old code's
  // ORDER BY created_at ASC LIMIT 1 per role).
  const roleToUserId = new Map<string, string>();
  if (roleSet.size > 0) {
    const userRes = await client.query(
      `SELECT DISTINCT ON (role) role, id
       FROM users
       WHERE role = ANY($1::text[]) AND is_active = TRUE
       ORDER BY role, created_at ASC`,
      [[...roleSet]],
    );
    for (const row of userRes.rows as Array<{ role: string; id: string }>) {
      roleToUserId.set(row.role, row.id);
    }
  }

  // Map raw → resolved
  const resolved: ResolvedStep[] = [];
  for (const raw of raws) {
    if (raw.approver_id) {
      resolved.push({
        step_order:  raw.step_order,
        approver_id: raw.approver_id,
        label:       raw.label,
        action_type: raw.action_type,
      });
    } else if (raw.approver_role) {
      const uid = roleToUserId.get(raw.approver_role);
      if (!uid) {
        throw Object.assign(
          new Error(
            `${errorPrefix ? errorPrefix + 'の' : ''}ステップ "${raw.label}" の承認者（役割: ${raw.approver_role}）が見つかりません`,
          ),
          { status: 422 },
        );
      }
      resolved.push({
        step_order:  raw.step_order,
        approver_id: uid,
        label:       raw.label,
        action_type: raw.action_type,
      });
    } else {
      throw Object.assign(
        new Error(
          `${errorPrefix ? errorPrefix + 'の' : ''}ステップ "${raw.label}" に承認者が設定されていません`,
        ),
        { status: 422 },
      );
    }
  }

  return resolved;
}
