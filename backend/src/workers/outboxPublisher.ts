// Outbox publisher worker.
//
// Runs as a separate process alongside the API and CSV worker.
// Delivery path:
//   route transaction -> event_outbox row + pg_notify on commit
//   outbox worker LISTEN wake-up -> Redis pub/sub publish
//   API SSE connections -> browser cache invalidation
//
// LISTEN/NOTIFY gives near-real-time delivery without hot polling. The 30s
// fallback sweep is only a safety net for missed notifications, worker restarts,
// or rows created before this process started.

import '../config/env';

import { pool } from '../config/db';
import {
  OUTBOX_NOTIFY_CHANNEL,
  cleanupPublished,
  drainOnce,
} from '../services/eventOutbox';
import type pg from 'pg';

const BATCH_SIZE       = 50;
const FALLBACK_POLL_MS = 30_000;
const RETRY_POLL_MS    = 2_000;
const CLEANUP_EVERY_MS = 5 * 60_000;
const RETENTION_HOURS  = 24;

let stopping = false;
let drainTimer:           NodeJS.Timeout | null = null;
let cleanupTimer:         NodeJS.Timeout | null = null;
let fallbackTimer:        NodeJS.Timeout | null = null;
let listenReconnectTimer: NodeJS.Timeout | null = null;
let listenClient:         pg.PoolClient | null = null;
let draining = false;

function scheduleDrain(delayMs = 0): void {
  if (stopping) return;
  if (drainTimer) {
    if (delayMs > 0) return;
    clearTimeout(drainTimer);
    drainTimer = null;
  }

  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drainLoop();
  }, delayMs);
  drainTimer.unref();
}

async function drainLoop(): Promise<void> {
  if (stopping || draining) return;
  draining = true;

  try {
    while (!stopping) {
      const drained = await drainOnce(BATCH_SIZE);
      if (drained < BATCH_SIZE) break;
    }
  } catch (err) {
    console.error('[outbox-publisher] drain failed', err);
    scheduleDrain(RETRY_POLL_MS);
  } finally {
    draining = false;
  }
}

function scheduleListenReconnect(): void {
  if (stopping || listenReconnectTimer) return;
  listenReconnectTimer = setTimeout(() => {
    listenReconnectTimer = null;
    void startOutboxListener();
  }, RETRY_POLL_MS);
  listenReconnectTimer.unref();
}

async function startOutboxListener(): Promise<void> {
  if (stopping || listenClient) return;

  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    listenClient = client;

    client.on('notification', (msg) => {
      if (msg.channel === OUTBOX_NOTIFY_CHANNEL) scheduleDrain(0);
    });

    client.on('error', (err) => {
      console.error('[outbox-publisher] LISTEN connection failed', err);
      if (listenClient === client) listenClient = null;
      try { client?.release(); } catch { /* ignore */ }
      scheduleListenReconnect();
    });

    await client.query(`LISTEN ${OUTBOX_NOTIFY_CHANNEL}`);
    console.log(`[outbox-publisher] listening on ${OUTBOX_NOTIFY_CHANNEL}`);
  } catch (err) {
    if (listenClient === client) listenClient = null;
    try { client?.release(); } catch { /* ignore */ }
    console.error('[outbox-publisher] LISTEN setup failed', err);
    scheduleListenReconnect();
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
      cleanupTimer.unref();
    }
  }
}

console.log('[outbox-publisher] starting');
void startOutboxListener();
scheduleDrain(0);
fallbackTimer = setInterval(() => scheduleDrain(0), FALLBACK_POLL_MS);
fallbackTimer.unref();
cleanupTimer = setTimeout(cleanupTick, CLEANUP_EVERY_MS);
cleanupTimer.unref();

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[outbox-publisher] ${signal} received, draining`);
  stopping = true;

  if (drainTimer)           clearTimeout(drainTimer);
  if (cleanupTimer)         clearTimeout(cleanupTimer);
  if (fallbackTimer)        clearInterval(fallbackTimer);
  if (listenReconnectTimer) clearTimeout(listenReconnectTimer);

  if (listenClient) {
    await listenClient.query(`UNLISTEN ${OUTBOX_NOTIFY_CHANNEL}`).catch(() => {});
    listenClient.release();
    listenClient = null;
  }

  try { await drainOnce(BATCH_SIZE); } catch { /* ignore */ }
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
