// SSE delivery layer.
//
// Architecture:
//
//   route handler / worker
//        ↓ insert outbox row inside DB tx
//   event_outbox (Postgres)
//        ↓ outboxPublisher worker polls + publishes
//   Redis pub/sub (channel: ringo:sse)
//        ↓ this module subscribes (once per API process)
//   in-memory client registry (Map<userId, Set<Response>>)
//        ↓ filter by recipient list, write to matching responses
//   EventSource on browser
//
// Reliability properties:
//   - At-least-once delivery (outbox survives Redis/API crashes)
//   - Multi-instance correct (Redis fans out to every API process)
//   - Reconnect replay (Last-Event-ID header → outbox query for missed rows)
//   - Connection cap + heartbeat + abs timeout → no leaks

import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middlewares/authMiddleware';
import { subscribe, publish, BusEvent } from '../services/sseEventBus';
import { replayEventsForUser, insertOutboxEvent } from '../services/eventOutbox';
import { withTransaction } from '../config/db';

const router = Router();

// ── Connection registry ─────────────────────────────────────────────────────
// userId → set of active response objects for that user (multi-tab support).
const clients = new Map<string, Set<Response>>();

// Per-connection metadata, keyed on Response object identity.
interface ConnMeta { abortTimer: NodeJS.Timeout; heartbeat: NodeJS.Timeout }
const connMeta = new WeakMap<Response, ConnMeta>();

const ABS_CONN_TIMEOUT_MS = 30 * 60_000;   // 30 min
const HEARTBEAT_MS        = 25_000;
const MAX_CONCURRENT      = 500;

let activeConnections = 0;

function register(userId: string, res: Response, abortTimer: NodeJS.Timeout, heartbeat: NodeJS.Timeout): void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
  connMeta.set(res, { abortTimer, heartbeat });
  activeConnections++;
}

function unregister(userId: string, res: Response): void {
  clients.get(userId)?.delete(res);
  if (clients.get(userId)?.size === 0) clients.delete(userId);
  const meta = connMeta.get(res);
  if (meta) {
    clearInterval(meta.heartbeat);
    clearTimeout(meta.abortTimer);
    connMeta.delete(res);
  }
  activeConnections = Math.max(0, activeConnections - 1);
}

// EventSource wire-format writer. `id` is the outbox row UUID — browser
// stores it as Last-Event-ID and sends it back on reconnect.
function writeEvent(res: Response, event: string, data: unknown, id?: string): void {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Bus subscription (fires once per API process) ───────────────────────────
//
// Every event published anywhere (this instance or another) lands here.
// We filter by recipient_user_ids and forward only to locally-connected
// clients matching that list.
let busHandlerInstalled = false;
function installBusHandler(): void {
  if (busHandlerInstalled) return;
  busHandlerInstalled = true;

  subscribe((event: BusEvent) => {
    if (event.broadcast) {
      // Fan out to every locally-connected client (e.g. TEMPLATE_UPDATED)
      for (const [, conns] of clients) {
        for (const res of conns) {
          try {
            writeEvent(res, event.event_type, event.payload, event.id);
          } catch { /* disconnected */ }
        }
      }
      return;
    }
    for (const userId of event.recipient_user_ids) {
      const conns = clients.get(userId);
      if (!conns) continue;
      for (const res of conns) {
        try {
          writeEvent(res, event.event_type, event.payload, event.id);
        } catch {
          // Connection died mid-write — let req.on('close') clean it up
        }
      }
    }
  });
}
installBusHandler();

// ── Optional legacy emit helpers (used only by code that hasn't migrated to
//    outbox yet — kept for compatibility, will be removed once all callers
//    use insertOutboxEvent). Both write directly to local clients only and
//    DO NOT fan out across instances — outbox path is the only correct one
//    for multi-instance.
export async function emitDirectToUsers(userIds: string[], event_type: string, payload: Record<string, unknown> = {}): Promise<void> {
  for (const uid of userIds) {
    const conns = clients.get(uid);
    if (!conns) continue;
    for (const res of conns) {
      try { writeEvent(res, event_type, payload); } catch { /* disconnected */ }
    }
  }
}

/**
 * Convenience: insert outbox row in its own tx and let the worker publish it.
 *
 * Use this when a route handler is NOT inside its own DB transaction (e.g.
 * a simple POST that just touches one row). Prefer the inline pattern when
 * inside withTransaction(...) — pass the same client to insertOutboxEvent.
 */
export async function publishEvent(input: {
  event_type:         string;
  entity_type:        string;
  entity_id?:         string | null;
  recipient_user_ids: string[];
  payload?:           Record<string, unknown>;
}): Promise<string> {
  return withTransaction(async (client) => insertOutboxEvent(client, input));
}

// ── Broadcast emit ──────────────────────────────────────────────────────────
// Publishes through the SSE bus with broadcast=true so EVERY instance fans the
// event out to its locally-connected clients. Use for global signals like
// TEMPLATE_UPDATED that every user needs to receive regardless of recipient list.
// Fire-and-forget — failures are logged but don't block the request.
export function emitAll(event: string, data: unknown = {}): void {
  const payload = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : { value: data };
  publish({
    id:                 randomUUID(),
    event_type:         event,
    recipient_user_ids: [],
    payload,
    broadcast:          true,
  }).catch((err) => console.error('[sse] broadcast publish failed:', err));
}
export function emitToUsers(userIds: string[], event: string, data: unknown = {}): void {
  void emitDirectToUsers(userIds, event, typeof data === 'object' && data !== null ? data as Record<string, unknown> : { value: data });
}

// ── SSE endpoint ────────────────────────────────────────────────────────────
router.use(requireAuth);

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  if (activeConnections >= MAX_CONCURRENT) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: 'server busy — retry shortly' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  res.flushHeaders();

  // ── Last-Event-ID replay ──────────────────────────────────────────────
  // EventSource auto-sends this header on reconnect; we read it and stream
  // any events the user was a recipient of that they missed.
  const lastEventId = (req.headers['last-event-id'] ?? '') as string;
  if (lastEventId) {
    try {
      const missed = await replayEventsForUser(userId, lastEventId);
      for (const ev of missed) {
        writeEvent(res, ev.event_type, ev.payload, ev.id);
      }
    } catch (err) {
      console.error('[sse] replay failed for user', userId, err);
      // Don't kill the connection — fresh-state fallback via React Query
      // window-focus refetch covers the gap.
    }
  }

  // Heartbeat — keeps idle proxies from dropping the connection
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* will be cleaned up below */ }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // Absolute connection timeout — force-close after N minutes to prevent leaks
  const abortTimer = setTimeout(() => {
    try { res.end(); } catch { /* already gone */ }
  }, ABS_CONN_TIMEOUT_MS);
  abortTimer.unref();

  register(userId, res, abortTimer, heartbeat);

  // Initial handshake event
  writeEvent(res, 'connected', { userId, ts: Date.now() });

  req.on('close', () => {
    unregister(userId, res);
  });
});

// Diagnostic endpoint (admin/ops use only — wire later if needed)
router.get('/_stats', requireAuth, (_req, res) => {
  res.json({
    activeConnections,
    uniqueUsers: clients.size,
  });
});

export default router;
