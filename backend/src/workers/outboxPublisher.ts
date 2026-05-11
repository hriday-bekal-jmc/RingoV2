// Outbox publisher worker.
//
// Runs as a separate process (PM2 proc 3 alongside api + csv-worker).
// Polls event_outbox for unpublished rows, publishes them to Redis pub/sub
// via sseEventBus, marks them published.
//
// Why a separate process:
//   - Decouples API uptime from event delivery. API crash mid-emit doesn't
//     lose events — they sit in outbox until worker picks them up.
//   - Keeps event publishing off the request hot path. POST returns the
//     instant the DB tx commits; user doesn't wait for Redis.
//   - Multiple instances can run safely thanks to FOR UPDATE SKIP LOCKED.
//
// Start (dev):    npm run worker:outbox    (tsx watch)
// Start (prod):   node dist/workers/outboxPublisher.js  (via PM2)

// Boot env first — fail fast on bad config
import '../config/env';

import { pool } from '../config/db';
import { drainOnce, cleanupPublished } from '../services/eventOutbox';

const POLL_INTERVAL_MS = 250;        // 4× per second
const BATCH_SIZE       = 50;          // rows per claim
const CLEANUP_EVERY_MS = 5 * 60_000;  // 5 min
const RETENTION_HOURS  = 24;          // keep published rows for replay window

let stopping = false;
let pollTimer:    NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

// Adaptive backoff: when many rows drained, poll faster. When idle, slow down
// to reduce DB load. Floor 250ms, ceil 2s.
let currentInterval = POLL_INTERVAL_MS;
const MIN_INTERVAL  = 250;
const MAX_INTERVAL  = 2_000;

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    const drained = await drainOnce(BATCH_SIZE);

    // Adjust interval based on activity
    if (drained > 0) {
      currentInterval = MIN_INTERVAL;
      if (drained === BATCH_SIZE) {
        // Hit the batch ceiling — there's likely more, poll again immediately
        setImmediate(tick);
        return;
      }
    } else {
      currentInterval = Math.min(MAX_INTERVAL, currentInterval * 1.5);
    }
  } catch (err) {
    console.error('[outbox-publisher] drain failed', err);
    // Back off on error to avoid hammering broken systems
    currentInterval = MAX_INTERVAL;
  } finally {
    if (!stopping) {
      pollTimer = setTimeout(tick, currentInterval);
    }
  }
}

async function cleanupTick(): Promise<void> {
  if (stopping) return;
  try {
    const n = await cleanupPublished(RETENTION_HOURS);
    if (n > 0) console.log(`[outbox-publisher] cleaned up ${n} old rows`);
  } catch (err) {
    console.error('[outbox-publisher] cleanup failed', err);
  } finally {
    if (!stopping) {
      cleanupTimer = setTimeout(cleanupTick, CLEANUP_EVERY_MS);
    }
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
console.log('[outbox-publisher] starting');
pollTimer    = setTimeout(tick,        POLL_INTERVAL_MS);
cleanupTimer = setTimeout(cleanupTick, CLEANUP_EVERY_MS);

// ── Graceful shutdown ───────────────────────────────────────────────────────
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[outbox-publisher] ${signal} received, draining`);
  stopping = true;
  if (pollTimer)    clearTimeout(pollTimer);
  if (cleanupTimer) clearTimeout(cleanupTimer);
  // Best-effort final drain so in-flight events get out
  try { await drainOnce(BATCH_SIZE); } catch { /* ignore */ }
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
