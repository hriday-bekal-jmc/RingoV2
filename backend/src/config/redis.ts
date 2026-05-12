import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Shared connection options. ioredis requires SEPARATE connections for
// pub/sub subscribers vs everything else, because .subscribe() puts a
// connection into pub/sub mode where regular commands are blocked.
//
// Three clients:
//   - redis        — general purpose (cache reads/writes, ratelimit, etc.)
//   - redisSub     — dedicated subscriber for SSE event bus
//   - bullConnection — config object that BullMQ creates its own clients from
const baseOptions = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
};

export const redis = new Redis(baseOptions);

// Subscriber: separate connection, ONLY used by sseEventBus.subscribe().
// Do NOT issue regular commands on this client — they'll fail.
export const redisSub = new Redis(baseOptions);

// Helpful logging — but DEDUPED so a flapping connection doesn't flood logs.
// ioredis fires 'error' on EVERY retry (100ms-3s). Log once per disconnect
// cycle: first error → log it + set flag. Reconnect ('ready' event) clears
// flag and logs once. All retries in between are silent.
function attachDedupedLogging(client: Redis, label: string): void {
  let disconnectLogged = false;
  client.on('error', (err: Error) => {
    if (disconnectLogged) return;
    disconnectLogged = true;
    console.warn(`[${label}] disconnected: ${err.message} (retries silent until reconnect)`);
  });
  client.on('ready', () => {
    if (disconnectLogged) console.log(`[${label}] reconnected`);
    else                  console.log(`[${label}] connected`);
    disconnectLogged = false;
  });
  client.on('end', () => {
    if (!disconnectLogged) {
      disconnectLogged = true;
      console.warn(`[${label}] connection closed`);
    }
  });
}

attachDedupedLogging(redis,    'redis');
attachDedupedLogging(redisSub, 'redis-sub');

// BullMQ wants a plain options object, not a client — it manages its own
// connections internally for queue + worker pairs.
export const bullConnection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null,
};
