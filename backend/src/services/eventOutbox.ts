// Transactional outbox service.
//
// Call insertOutboxEvent(client, ...) INSIDE the same DB transaction as the
// business change. The row is committed atomically — either both the change
// and the event row land, or neither does. No orphans, no lost events.
//
// outboxPublisher.ts polls unpublished rows and publishes them to Redis
// pub/sub via sseEventBus.publish(). Failures stay in the table for retry.

import { pool, query } from '../config/db';
import type pg from 'pg';
import { publish, BusEvent } from './sseEventBus';

export const OUTBOX_NOTIFY_CHANNEL = 'event_outbox_new';

export interface OutboxInsertInput {
  event_type:         string;
  entity_type:        string;
  entity_id?:         string | null;
  recipient_user_ids: string[];
  payload?:           Record<string, unknown>;
}

/**
 * Insert an outbox row inside the caller's transaction. The client argument
 * MUST be the same pg client that wrote the business change — otherwise the
 * atomicity guarantee is broken.
 *
 * Returns the row id so the caller can correlate (rarely needed).
 */
export async function insertOutboxEvent(
  client: pg.PoolClient,
  input:  OutboxInsertInput,
): Promise<string> {
  const r = await client.query(
    `INSERT INTO event_outbox
       (event_type, entity_type, entity_id, recipient_user_ids, payload)
     VALUES ($1, $2, $3, $4::uuid[], $5::jsonb)
     RETURNING id`,
    [
      input.event_type,
      input.entity_type,
      input.entity_id ?? null,
      input.recipient_user_ids,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const id = r.rows[0].id as string;
  await client.query(`SELECT pg_notify($1, $2)`, [OUTBOX_NOTIFY_CHANNEL, id]);
  return id;
}

/**
 * Claim a batch of unpublished rows for publishing.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so multiple worker instances can drain the
 * table in parallel without stepping on each other. Each worker grabs a
 * disjoint batch; locked rows are skipped, not waited on.
 *
 * Returns the rows but does NOT mark them published — caller publishes to
 * Redis first, then calls markPublished() on success.
 */
export async function claimUnpublished(batchSize = 50): Promise<BusEvent[]> {
  // Claim rows with a short lease, then publish outside the tx. The lease
  // prevents another worker from claiming the same row while this worker is
  // publishing. If this process crashes, locked_until expires and the row is
  // retried by another worker.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `WITH claim AS (
         SELECT id
         FROM event_outbox
         WHERE published_at IS NULL
           AND (locked_until IS NULL OR locked_until < NOW())
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE event_outbox e
       SET attempts = attempts + 1,
           locked_until = NOW() + INTERVAL '30 seconds'
       FROM claim
       WHERE e.id = claim.id
       RETURNING e.id, e.event_type, e.entity_type, e.entity_id, e.recipient_user_ids, e.payload`,
      [batchSize],
    );
    await client.query('COMMIT');

    return r.rows.map((row) => ({
      id:                 row.id as string,
      event_type:         row.event_type as string,
      entity_type:        row.entity_type as string,
      entity_id:          row.entity_id as string | null,
      recipient_user_ids: row.recipient_user_ids as string[],
      payload:            (row.payload as Record<string, unknown>) ?? {},
    }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark rows as successfully published. Called after Redis publish returns.
 */
export async function markPublished(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(
    `UPDATE event_outbox
     SET published_at = NOW(),
         locked_until = NULL
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

/**
 * Record a publish failure for diagnostics. Row stays unpublished so the
 * next poll cycle retries it.
 */
export async function recordPublishError(ids: string[], message: string): Promise<void> {
  if (ids.length === 0) return;
  await query(
    `UPDATE event_outbox
     SET last_error = $2,
         locked_until = NULL
     WHERE id = ANY($1::uuid[])`,
    [ids, message.slice(0, 500)],
  );
}

/**
 * Drain a batch: claim → publish to Redis → mark published.
 * Returns count of rows successfully published.
 */
export async function drainOnce(batchSize = 50): Promise<number> {
  const events = await claimUnpublished(batchSize);
  if (events.length === 0) return 0;

  // Publish each event. If any fail, mark only the successful ones.
  const successIds: string[] = [];
  const failedIds:  string[] = [];
  let lastError = '';

  for (const ev of events) {
    try {
      await publish(ev);
      successIds.push(ev.id);
    } catch (err) {
      failedIds.push(ev.id);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (successIds.length > 0) await markPublished(successIds);
  if (failedIds.length  > 0) await recordPublishError(failedIds, lastError);

  return successIds.length;
}

/**
 * Periodic cleanup: drop published rows older than retention.
 * Called from outboxPublisher every ~5 min. Keeps table small while still
 * supporting Last-Event-ID replay for clients reconnecting after <24h gap.
 */
export async function cleanupPublished(retentionHours = 24): Promise<number> {
  const r = await query(
    `DELETE FROM event_outbox
     WHERE published_at IS NOT NULL
       AND published_at < NOW() - ($1::int || ' hours')::interval`,
    [retentionHours],
  );
  return r.rowCount ?? 0;
}

/**
 * Last-Event-ID replay support.
 *
 * Returns events newer than (or equal in age to) `sinceCreatedAt` that the
 * user is a recipient of, ordered by created_at ASC so playback is in order.
 *
 * Caller (sseRoutes) maps each row into the EventSource wire format with
 * `id: <uuid>` so the browser's auto-stored Last-Event-ID stays consistent.
 */
export async function replayEventsForUser(
  userId:          string,
  sinceEventId:    string,
  maxRows:         number = 200,
): Promise<BusEvent[]> {
  // Look up the created_at of the cursor event, then return everything newer.
  // If the cursor event itself is already cleaned up (>24h), we return [] —
  // browser will get fresh state from React Query refetches on visibility.
  const cursorRes = await query(
    `SELECT created_at FROM event_outbox WHERE id = $1`,
    [sinceEventId],
  );
  if (cursorRes.rows.length === 0) return [];
  const since = cursorRes.rows[0].created_at as Date;

  const r = await query(
    `SELECT id, event_type, entity_type, entity_id, recipient_user_ids, payload
     FROM event_outbox
     WHERE created_at > $1
       AND $2::uuid = ANY(recipient_user_ids)
     ORDER BY created_at ASC
     LIMIT $3`,
    [since, userId, maxRows],
  );

  return r.rows.map((row) => ({
    id:                 row.id as string,
    event_type:         row.event_type as string,
    entity_type:        row.entity_type as string,
    entity_id:          row.entity_id as string | null,
    recipient_user_ids: row.recipient_user_ids as string[],
    payload:            (row.payload as Record<string, unknown>) ?? {},
  }));
}
