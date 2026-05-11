-- Migration 016: event_outbox table
--
-- Implements the transactional outbox pattern for SSE event delivery.
--
-- Why this exists:
--   In-process emit (emitAll/emitToUsers) fails in three real-world scenarios:
--     1. Multiple Node instances — event published on instance A never reaches
--        users on instance B unless a shared pub/sub bus exists.
--     2. Crash between DB commit and emit — event lost forever.
--     3. Redis pub/sub at-most-once delivery — if subscriber is briefly offline,
--        event is dropped (Redis Pub/Sub has no buffer).
--
-- The outbox pattern fixes all three:
--   - Every event is inserted in the SAME transaction as its business change.
--     Either both commit or neither — atomic, no orphans.
--   - A separate worker process polls unpublished rows, publishes them to Redis
--     pub/sub, and marks them published. Surviving Redis downtime → rows stay
--     unpublished, worker retries on next poll.
--   - The row also supports Last-Event-ID replay: when an EventSource reconnects
--     with a Last-Event-ID header, the server queries outbox for rows newer than
--     that ID matching the user's recipient list and streams them down.
--
-- Schema notes:
--   - id is UUID for global uniqueness across instances; the EventSource id:
--     field uses the textual UUID for replay.
--   - recipient_user_ids is a UUID[] so each event carries its own audience.
--     Empty array would mean broadcast — we avoid that for security/perf.
--   - payload is JSONB so each event type carries arbitrary shape.
--   - published_at is set ONLY after successful Redis publish. NULL = unpublished.
--   - attempts + last_error are debug aids for stuck rows.

CREATE TABLE IF NOT EXISTS event_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          VARCHAR(64) NOT NULL,
  entity_type         VARCHAR(32) NOT NULL,
  entity_id           UUID,
  recipient_user_ids  UUID[] NOT NULL DEFAULT '{}',
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at        TIMESTAMPTZ,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT
);

-- Worker polls this index w/ ORDER BY created_at ASC LIMIT N FOR UPDATE SKIP LOCKED.
-- Partial index keeps it tiny — only unpublished rows matter for the hot path.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON event_outbox (created_at)
  WHERE published_at IS NULL;

-- Last-Event-ID replay path: WHERE entity_type/entity_id (sometimes) and
-- recipient_user_ids @> ARRAY[$userId]::uuid[] AND created_at > $since
CREATE INDEX IF NOT EXISTS idx_outbox_recipients
  ON event_outbox USING GIN (recipient_user_ids);

-- Cleanup helper for cron / worker: drop published rows older than 24h.
-- DELETE FROM event_outbox WHERE published_at < NOW() - INTERVAL '24 hours';
