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

// Helpful logging for both
redis.on('error',    (err: Error) => console.error('[redis] connection error', err.message));
redis.on('ready',    () => console.log('[redis] connected'));
redisSub.on('error', (err: Error) => console.error('[redis-sub] connection error', err.message));
redisSub.on('ready', () => console.log('[redis-sub] connected (pub/sub)'));

// BullMQ wants a plain options object, not a client — it manages its own
// connections internally for queue + worker pairs.
export const bullConnection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null,
};
