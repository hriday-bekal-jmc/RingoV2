// SSE event bus — Redis pub/sub fanout layer between API instances.
//
// Architecture (Phase 2 of the SSE plan):
//
//   ┌─ API instance 1 ─┐         ┌─ API instance 2 ─┐
//   │  outbox worker   │         │  outbox worker   │
//   │  publishes ──────┼─────────┼─→ subscribes     │
//   │  ↓               │  Redis  │     ↓            │
//   │  local SSE       │  channel│  local SSE       │
//   │  clients         │ ringo:sse│  clients         │
//   └──────────────────┘         └──────────────────┘
//
// Any instance can publish; every instance receives; each instance forwards
// the event to its locally-connected SSE clients (filtered by recipient list).
//
// In single-instance mode this still works (pubsub through localhost Redis
// to self) — slight overhead but zero code-path divergence between dev and
// prod, which is exactly what we want.

import { redis, redisSub } from '../config/redis';

export const CHANNEL = 'ringo:sse';

/**
 * Wire-format event published over Redis. Kept compact — no business data,
 * just enough to identify recipients + tell frontend what to invalidate.
 */
export interface BusEvent {
  /** Stable id (matches event_outbox.id when published from outbox). */
  id:                 string;
  event_type:         string;
  entity_type?:       string;
  entity_id?:         string | null;
  recipient_user_ids: string[];
  payload:            Record<string, unknown>;
  /** When true, deliver to every locally-connected client regardless of recipient list. */
  broadcast?:         boolean;
}

type Handler = (event: BusEvent) => void;

const handlers = new Set<Handler>();

/**
 * Subscribe to the SSE bus. Call once per process at startup (e.g. in
 * sseRoutes module init). Returns an unsubscribe fn.
 */
export function subscribe(handler: Handler): () => void {
  handlers.add(handler);
  ensureSubscribed();
  return () => { handlers.delete(handler); };
}

let isSubscribed = false;
function ensureSubscribed(): void {
  if (isSubscribed) return;
  isSubscribed = true;

  // Fire-and-forget subscription. ioredis 'message' event fires for any
  // matching channel — we filter by CHANNEL just to be safe.
  redisSub.subscribe(CHANNEL).catch((err) => {
    console.error('[sse-bus] subscribe failed', err);
  });

  redisSub.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    let event: BusEvent;
    try {
      event = JSON.parse(raw) as BusEvent;
    } catch (err) {
      console.error('[sse-bus] bad message JSON', err, raw);
      return;
    }
    // Fan out to all local handlers
    for (const h of handlers) {
      try { h(event); } catch (err) { console.error('[sse-bus] handler error', err); }
    }
  });
}

/**
 * Publish an event to all instances. Returns the count of subscribers reached
 * (across all instances, per ioredis docs). For diagnostics only.
 *
 * In normal flow, outboxPublisher.ts calls this — not the route handlers.
 * Route handlers insert outbox rows; the worker drains them.
 */
export async function publish(event: BusEvent): Promise<number> {
  return redis.publish(CHANNEL, JSON.stringify(event));
}
