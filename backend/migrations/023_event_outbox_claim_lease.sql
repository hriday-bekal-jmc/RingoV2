-- Migration 023: event_outbox claim lease
--
-- Lets multiple outbox workers run without repeatedly claiming the same
-- unpublished row. If a worker crashes after claiming, locked_until expires
-- and another worker retries the row.

ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbox_ready_lease
  ON event_outbox (created_at, locked_until)
  WHERE published_at IS NULL;
