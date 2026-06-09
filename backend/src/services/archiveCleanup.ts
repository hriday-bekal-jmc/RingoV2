// Auto-archive — soft-archives terminal applications that have been inactive
// longer than ARCHIVE_AFTER_DAYS (default 365). Runs on a cron schedule.
//
// WHY: archived rows leave the `WHERE archived_at IS NULL` partial indexes, so
// every hot query (dashboards, history, approvals) keeps scanning only the
// small active set. As the system runs for years, hot-query load stays flat
// instead of growing. Archived apps are NOT deleted — users/admins can still
// view them via ?include_archived=true.
//
// Safe-by-design:
//   - Only COMPLETED / REJECTED / CANCELLED (terminal) apps are touched.
//   - Batched with FOR UPDATE SKIP LOCKED → short transactions, no long locks,
//     never blocks live traffic.
//   - archived_by = NULL + archive_reason marks it as a system action.
//   - No per-app SSE/outbox spam; just invalidates affected dashboard caches.

import cron from 'node-cron';
import { query, withTransaction } from '../config/db';
import { redis } from '../config/redis';
import { env } from '../config/env';

const BATCH_SIZE = 500;        // rows per transaction
const MAX_BATCHES = 200;       // hard cap per run (100k rows) — backstop vs runaway
const ARCHIVE_REASON = `auto: inactive > ${env.ARCHIVE_AFTER_DAYS} days`;

// Archive one batch. Returns rows archived + the distinct applicant_ids
// (for cache invalidation). count === 0 means nothing left to do.
async function archiveBatch(): Promise<{ count: number; applicants: string[] }> {
  return withTransaction(async (client) => {
    // Lock a batch of eligible rows; SKIP LOCKED so concurrent runs/edits
    // never deadlock. Age is measured from a STABLE timestamp — completed_at
    // (set once at completion), falling back to submitted_at / created_at for
    // REJECTED/CANCELLED. NOT updated_at: a BEFORE UPDATE trigger bumps that on
    // every write, so it can't represent "finished N days ago". Predicate +
    // ORDER BY match idx_apps_archive_scan exactly (index range scan).
    const picked = await client.query<{ id: string; applicant_id: string }>(
      `SELECT id, applicant_id
         FROM applications
        WHERE archived_at IS NULL
          AND status IN ('COMPLETED', 'REJECTED', 'CANCELLED')
          AND COALESCE(completed_at, submitted_at, created_at) < NOW() - ($1 || ' days')::interval
        ORDER BY COALESCE(completed_at, submitted_at, created_at) ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [String(env.ARCHIVE_AFTER_DAYS)],
    );
    if (picked.rows.length === 0) return { count: 0, applicants: [] };

    const ids = picked.rows.map((r) => r.id);
    // updated_at is intentionally not set here — the touch_updated_at trigger
    // stamps it to now() (the archive is itself a real update). archived_at is
    // the authoritative archive marker.
    await client.query(
      `UPDATE applications
          SET archived_at = NOW(),
              archived_by = NULL,
              archive_reason = $2
        WHERE id = ANY($1::uuid[])`,
      [ids, ARCHIVE_REASON],
    );

    return {
      count: ids.length,
      applicants: Array.from(new Set(picked.rows.map((r) => r.applicant_id))),
    };
  });
}

export async function runArchiveCleanup(): Promise<number> {
  let total = 0;
  const affected = new Set<string>();

  // Loop batches until a batch archives nothing (or the backstop cap is hit).
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { count, applicants } = await archiveBatch();
    if (count === 0) break;
    total += count;
    applicants.forEach((a) => affected.add(a));
  }

  // Invalidate dashboard caches for affected applicants + admin overview so the
  // next load reflects the reduced counts immediately (don't wait for TTL).
  if (affected.size > 0) {
    const keys = ['dashboard:admin-overview', ...Array.from(affected, (uid) => `dashboard:summary:${uid}`)];
    await redis.del(...keys).catch(() => { /* redis down → TTL handles it */ });
  }

  return total;
}

export function scheduleApplicationArchive(): void {
  if (env.ARCHIVE_ENABLED !== 'true') {
    console.log('[archive] ARCHIVE_ENABLED not "true" — auto-archive disabled');
    return;
  }
  const schedule = env.ARCHIVE_CRON;
  if (!cron.validate(schedule)) {
    console.error(`[archive] invalid ARCHIVE_CRON "${schedule}" — worker not started`);
    return;
  }
  console.log(`[archive] scheduled auto-archive at cron "${schedule}" (terminal apps > ${env.ARCHIVE_AFTER_DAYS}d)`);
  cron.schedule(schedule, async () => {
    const start = Date.now();
    try {
      const n = await runArchiveCleanup();
      console.log(`[archive] run complete — ${n} application(s) archived in ${Date.now() - start}ms`);
    } catch (err) {
      console.error('[archive] run failed:', err);
    }
  });
}
