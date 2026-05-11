// Compute recipient user IDs for each event type.
//
// Why this exists:
//   Previous design used emitAll(...) — every connected user got every event,
//   then every browser React-Query-invalidated and refetched data it didn't
//   even care about. Wasted bandwidth, wasted DB, noisy SSE log.
//
// Now: routes call computeApplicationRecipients(client, applicationId) etc.
// which returns the minimal set of user IDs that actually care:
//   - applicant
//   - previous approver (if any)
//   - current/next approver (if any)
//   - accounting/soumu users (only for settlement-stage events)
//
// All queries are read-only and run inside the same tx as the business
// change, so the recipient list reflects the post-change state — important
// because we want the NEXT approver to be notified, not the previous one.

import type pg from 'pg';

/**
 * Recipients for any application-scoped event (submit, approve, reject,
 * return, settlement actions). Returns deduped UUID list.
 *
 * Includes:
 *   - applicant_id from applications
 *   - approver_id from approval_steps with status='PENDING' (current active step)
 *   - approver_id from approval_steps with status IN ('APPROVED','REJECTED','RETURNED')
 *     (last actor, so they see what happened next)
 *
 * For settlement-stage events, additionally:
 *   - all active users with role SOUMU or ACCOUNTING or ADMIN
 *     (accounting dashboards rely on real-time updates)
 */
export async function computeApplicationRecipients(
  client:           pg.PoolClient | { query: pg.PoolClient['query'] },
  applicationId:    string,
  options: { includeAccounting?: boolean } = {},
): Promise<string[]> {
  const recipients = new Set<string>();

  const appRes = await client.query(
    `SELECT applicant_id FROM applications WHERE id = $1`,
    [applicationId],
  );
  if (appRes.rows.length === 0) return [];
  recipients.add(appRes.rows[0].applicant_id as string);

  // Every approver who has touched or is touching this app (across both stages)
  const stepRes = await client.query(
    `SELECT DISTINCT approver_id
     FROM approval_steps
     WHERE application_id = $1 AND approver_id IS NOT NULL`,
    [applicationId],
  );
  for (const r of stepRes.rows as Array<{ approver_id: string }>) {
    recipients.add(r.approver_id);
  }

  if (options.includeAccounting) {
    const acctRes = await client.query(
      `SELECT id FROM users
       WHERE is_active = TRUE AND role IN ('SOUMU', 'ACCOUNTING', 'ADMIN')`,
    );
    for (const r of acctRes.rows as Array<{ id: string }>) {
      recipients.add(r.id);
    }
  }

  return [...recipients];
}

/**
 * Recipients for events targeted at a single user (CSV export ready,
 * user-state-changed). Just wraps a UUID in a list for type symmetry.
 */
export function singleUserRecipient(userId: string): string[] {
  return [userId];
}
